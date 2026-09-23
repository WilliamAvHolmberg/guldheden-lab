import * as THREE from 'three';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe landmark indices
const NOSE = 0, EAR_L = 7, EAR_R = 8, SH_L = 11, SH_R = 12, EL_L = 13, EL_R = 14, WR_L = 15, WR_R = 16;
const HIP_L = 23, HIP_R = 24, KN_L = 25, KN_R = 26, AN_L = 27, AN_R = 28;
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8],
];

const DOWN = new THREE.Vector3(0, -1, 0);
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _qInv = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _pitchFix = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0));

/** Rotation whose +X is along xv and +Y is (roughly) along upv. */
function frame(xv, upv, out) {
  _x.copy(xv).normalize();
  _z.crossVectors(_x, upv).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** A single tracked body, smoothed, in character space (+X = person's left, +Y up, +Z towards camera). */
export class TrackedPose {
  constructor() {
    this.world = Array.from({ length: 33 }, () => new THREE.Vector3());
    this.image = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    this.init = false;
    this.legsVisible = false;
    this.cx = 0.5;
    this.shoulderWidth = 0.2;
  }

  ingest(worldLms, imageLms, alpha = 0.55) {
    for (let i = 0; i < 33; i++) {
      const w = worldLms[i];
      _a.set(w.x, -w.y, -w.z);
      if (!this.init) this.world[i].copy(_a); else this.world[i].lerp(_a, alpha);
      const im = imageLms[i];
      this.image[i].x = im.x; this.image[i].y = im.y; this.image[i].v = im.visibility ?? 1;
    }
    this.init = true;
    const vis = (i) => this.image[i].v;
    this.legsVisible = Math.min(vis(KN_L), vis(KN_R), vis(AN_L), vis(AN_R)) > 0.55;
    this.cx = 1 - (this.image[HIP_L].x + this.image[HIP_R].x + this.image[SH_L].x + this.image[SH_R].x) / 4; // mirrored
    this.shoulderWidth = Math.abs(this.image[SH_L].x - this.image[SH_R].x);
  }

  /** Write joint rotations into rig.target. */
  apply(rig) {
    const P = this.world;
    const hipMid = _a.addVectors(P[HIP_L], P[HIP_R]).multiplyScalar(0.5).clone();
    const shMid = _b.addVectors(P[SH_L], P[SH_R]).multiplyScalar(0.5).clone();
    const up = shMid.clone().sub(hipMid);

    const H = new THREE.Quaternion();
    if (this.legsVisible) {
      frame(_a.subVectors(P[HIP_L], P[HIP_R]), up, H);
      rig.target.hips.copy(H);
    } else {
      H.copy(rig.target.hips);
    }
    const Cw = frame(_a.subVectors(P[SH_L], P[SH_R]), up, new THREE.Quaternion());
    _qInv.copy(H).invert();
    rig.target.spine.identity();
    rig.target.chest.copy(_qInv).multiply(Cw);

    // head
    const earMid = _a.addVectors(P[EAR_L], P[EAR_R]).multiplyScalar(0.5).clone();
    const fwd = _b.subVectors(P[NOSE], earMid).normalize().clone();
    const ex = new THREE.Vector3().subVectors(P[EAR_L], P[EAR_R]).normalize();
    const hy = new THREE.Vector3().crossVectors(fwd, ex).normalize();
    const Hd = frame(ex, hy, new THREE.Quaternion()).multiply(_pitchFix);
    rig.target.neck.identity();
    rig.target.head.copy(Cw).invert().multiply(Hd);

    // arms
    const limb = (parentWorld, from, to, out) => {
      _a.subVectors(P[to], P[from]).normalize();
      _qInv.copy(parentWorld).invert();
      _a.applyQuaternion(_qInv);
      return out.setFromUnitVectors(DOWN, _a);
    };
    for (const [s, sh, el, wr] of [['L', SH_L, EL_L, WR_L], ['R', SH_R, EL_R, WR_R]]) {
      const U = limb(Cw, sh, el, rig.target['uArm' + s]);
      const Uw = _q2.copy(Cw).multiply(U);
      limb(Uw.clone(), el, wr, rig.target['fArm' + s]);
      rig.target['hand' + s].identity();
    }
    // legs (only when the camera can actually see them)
    if (this.legsVisible) {
      for (const [s, hp, kn, an] of [['L', HIP_L, KN_L, AN_L], ['R', HIP_R, KN_R, AN_R]]) {
        const T = limb(H, hp, kn, rig.target['thigh' + s]);
        const Tw = _q2.copy(H).multiply(T);
        limb(Tw.clone(), kn, an, rig.target['shin' + s]);
        rig.target['foot' + s].identity();
      }
      rig.offsetTarget.set(0, 0, 0);
    }
  }
}

export class PoseDriver {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.poses = [];
    this.lastVideoTime = -1;
    this.lastSeen = 0;
    this.playerCx = 0.5;
    this.status = 'off';
    this.fps = 0;
    this._fpsT = 0;
    this._fpsN = 0;
  }

  async start(numPoses = 2) {
    this.status = 'loading';
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('GPU delegate failed, falling back to CPU', e);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    await this.video.play();
    this.running = true;
    this.status = 'running';
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.poses = [];
    this.status = 'off';
  }

  detect(nowMs) {
    if (!this.running || !this.video || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const res = this.landmarker.detectForVideo(this.video, nowMs);
    const n = res.worldLandmarks?.length ?? 0;
    this._fpsN++;
    if (nowMs - this._fpsT > 1000) { this.fps = this._fpsN; this._fpsN = 0; this._fpsT = nowMs; }
    if (n === 0) {
      if (nowMs - this.lastSeen > 600) this.poses = [];
      return;
    }
    this.lastSeen = nowMs;
    // keep identity stable by matching on horizontal position
    const fresh = [];
    for (let i = 0; i < n; i++) {
      const lm = res.landmarks[i];
      const cx = 1 - (lm[HIP_L].x + lm[HIP_R].x + lm[SH_L].x + lm[SH_R].x) / 4;
      let best = null, bd = 0.25;
      for (const p of this.poses) {
        if (fresh.includes(p)) continue;
        const d = Math.abs(p.cx - cx);
        if (d < bd) { bd = d; best = p; }
      }
      const tp = best ?? new TrackedPose();
      tp.ingest(res.worldLandmarks[i], lm);
      fresh.push(tp);
    }
    this.poses = fresh;
    // the player's pose is the one closest to where the player was last frame
    this.poses.sort((a, b) => Math.abs(a.cx - this.playerCx) - Math.abs(b.cx - this.playerCx));
    this.playerCx = this.poses[0].cx;
  }

  get player() { return this.poses[0] ?? null; }
  get guest() { return this.poses[1] ?? null; }

  drawPreview(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (this.video && this.video.readyState >= 2) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.video, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const cols = ['#39ff9f', '#ffd166'];
    this.poses.forEach((p, k) => {
      ctx.strokeStyle = cols[k % 2];
      ctx.fillStyle = cols[k % 2];
      ctx.lineWidth = 3;
      for (const [a, b] of CONNECTIONS) {
        const A = p.image[a], B = p.image[b];
        if (A.v < 0.4 || B.v < 0.4) continue;
        ctx.beginPath();
        ctx.moveTo((1 - A.x) * W, A.y * H);
        ctx.lineTo((1 - B.x) * W, B.y * H);
        ctx.stroke();
      }
      for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        const A = p.image[i];
        if (A.v < 0.4) continue;
        ctx.beginPath(); ctx.arc((1 - A.x) * W, A.y * H, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = 'bold 13px system-ui, sans-serif';
      const top = p.image[0];
      ctx.fillText(k === 0 ? 'DU' : 'GÄST', (1 - top.x) * W - 10, Math.max(14, top.y * H - 24));
    });
    ctx.restore();
  }
}
