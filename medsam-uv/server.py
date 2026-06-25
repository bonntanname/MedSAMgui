# -*- coding: utf-8 -*-
"""
MedSAM browser backend (FastAPI).

Reuses the inference logic from the original PyQt5 gui.py, but exposes it over
HTTP so a React frontend can drive it:

  POST /api/upload   multipart image  -> {id, width, height}   (computes & caches embedding)
  POST /api/segment  {id, box, color} -> {mask}                 (RGBA PNG data URL of the mask)

Run from the medsam-uv project:
  uv run uvicorn server:app --reload --port 8000
"""
import base64
import io
import time
import uuid
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F
from PIL import Image
from skimage import transform
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from segment_anything import sam_model_registry

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
SAM_MODEL_TYPE = "vit_b"
MEDSAM_CKPT_PATH = REPO_ROOT / "work_dir" / "MedSAM" / "medsam_vit_b.pth"
MEDSAM_IMG_INPUT_SIZE = 1024

torch.manual_seed(2023)
np.random.seed(2023)
if torch.cuda.is_available():
    torch.cuda.empty_cache()
    torch.cuda.manual_seed(2023)

if torch.backends.mps.is_available():
    device = torch.device("mps")
else:
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
print(f"Loading MedSAM ({SAM_MODEL_TYPE}) on {device}, a sec...")
tic = time.perf_counter()
if not MEDSAM_CKPT_PATH.exists():
    raise FileNotFoundError(f"Checkpoint not found: {MEDSAM_CKPT_PATH}")
medsam_model = sam_model_registry[SAM_MODEL_TYPE](checkpoint=str(MEDSAM_CKPT_PATH)).to(device)
medsam_model.eval()
print(f"Done, took {time.perf_counter() - tic:.1f}s")

# In-memory store of uploaded images: id -> {embedding, H, W}
SESSIONS: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Inference (ported verbatim from gui.py)
# ---------------------------------------------------------------------------
@torch.no_grad()
def compute_embedding(img_3c: np.ndarray) -> torch.Tensor:
    img_1024 = transform.resize(
        img_3c, (1024, 1024), order=3, preserve_range=True, anti_aliasing=True
    ).astype(np.uint8)
    img_1024 = (img_1024 - img_1024.min()) / np.clip(
        img_1024.max() - img_1024.min(), a_min=1e-8, a_max=None
    )
    img_1024_tensor = (
        torch.tensor(img_1024).float().permute(2, 0, 1).unsqueeze(0).to(device)
    )
    return medsam_model.image_encoder(img_1024_tensor)  # (1, 256, 64, 64)


@torch.no_grad()
def medsam_inference(img_embed, box_1024, height, width) -> np.ndarray:
    box_torch = torch.as_tensor(box_1024, dtype=torch.float, device=img_embed.device)
    if len(box_torch.shape) == 2:
        box_torch = box_torch[:, None, :]  # (B, 1, 4)

    sparse_embeddings, dense_embeddings = medsam_model.prompt_encoder(
        points=None, boxes=box_torch, masks=None
    )
    low_res_logits, _ = medsam_model.mask_decoder(
        image_embeddings=img_embed,
        image_pe=medsam_model.prompt_encoder.get_dense_pe(),
        sparse_prompt_embeddings=sparse_embeddings,
        dense_prompt_embeddings=dense_embeddings,
        multimask_output=False,
    )
    low_res_pred = torch.sigmoid(low_res_logits)
    low_res_pred = F.interpolate(
        low_res_pred, size=(height, width), mode="bilinear", align_corners=False
    )
    low_res_pred = low_res_pred.squeeze().cpu().numpy()
    return (low_res_pred > 0.5).astype(np.uint8)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
app = FastAPI(title="MedSAM Web")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    id: str
    box: list[float]              # [xmin, ymin, xmax, ymax] in original image pixels
    color: list[int] = [255, 0, 0]  # RGB tint for the returned mask
    alpha: int = 150              # 0-255 opacity of the mask overlay


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not read image: {exc}")

    img_3c = np.array(img)
    H, W = img_3c.shape[:2]

    embedding = compute_embedding(img_3c)
    sid = uuid.uuid4().hex
    SESSIONS[sid] = {"embedding": embedding, "H": H, "W": W}
    return {"id": sid, "width": W, "height": H}


@app.post("/api/segment")
async def segment(req: SegmentRequest):
    sess = SESSIONS.get(req.id)
    if sess is None:
        raise HTTPException(404, "Unknown image id (re-upload the image)")
    if len(req.box) != 4:
        raise HTTPException(400, "box must be [xmin, ymin, xmax, ymax]")

    H, W = sess["H"], sess["W"]
    xmin, ymin, xmax, ymax = req.box
    box_np = np.array([[xmin, ymin, xmax, ymax]])
    box_1024 = box_np / np.array([W, H, W, H]) * 1024

    mask = medsam_inference(sess["embedding"], box_1024, H, W)  # (H, W) uint8 {0,1}

    # Build an RGBA overlay: tinted where mask==1, transparent elsewhere.
    r, g, b = (int(c) for c in req.color[:3])
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    sel = mask != 0
    rgba[sel] = [r, g, b, int(req.alpha)]

    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    return {"mask": data_url, "width": W, "height": H}


@app.get("/api/health")
async def health():
    return {"status": "ok", "device": str(device), "sessions": len(SESSIONS)}
