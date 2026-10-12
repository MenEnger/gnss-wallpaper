/// <reference lib="webworker" />
import { json2satrec, propagate, type SatRec } from 'satellite.js';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let gen = -1;
let satrecs: (SatRec | null)[] = [];

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/** 1 衛星の位置を out[offset..offset+2] に書く。失敗時は NaN。 */
function write(rec: SatRec | null, date: Date, out: Float32Array, offset: number): void {
  const pv = rec ? propagate(rec, date) : null;
  if (pv) {
    out[offset] = pv.position.x;
    out[offset + 1] = pv.position.y;
    out[offset + 2] = pv.position.z;
  } else {
    out[offset] = out[offset + 1] = out[offset + 2] = NaN;
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    gen = msg.gen;
    let failed = 0;
    satrecs = msg.omms.map((omm) => {
      try {
        return json2satrec(omm);
      } catch {
        failed++;
        return null;
      }
    });
    post({ type: 'ready', gen, count: satrecs.length, failed });
    return;
  }
  if (msg.gen !== gen) return;

  const n = satrecs.length;
  const date = new Date();
  if (msg.type === 'samples') {
    const data = new Float32Array(msg.times.length * n * 3);
    msg.times.forEach((t, ti) => {
      date.setTime(t);
      for (let i = 0; i < n; i++) write(satrecs[i], date, data, (ti * n + i) * 3);
    });
    post({ type: 'samples', gen, id: msg.id, times: msg.times, data }, [data.buffer]);
  } else if (msg.type === 'orbits') {
    const seg = msg.segments;
    const data = new Float32Array(n * seg * 3);
    for (let i = 0; i < n; i++) {
      const rec = satrecs[i];
      // no: 平均運動 [rad/min]
      const periodMs = rec && rec.no > 0 ? ((2 * Math.PI) / rec.no) * 60_000 : 0;
      for (let k = 0; k < seg; k++) {
        date.setTime(msg.time + (periodMs * k) / seg);
        write(periodMs ? rec : null, date, data, (i * seg + k) * 3);
      }
    }
    post({ type: 'orbits', gen, id: msg.id, time: msg.time, segments: seg, data }, [data.buffer]);
  }
};
