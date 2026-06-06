import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export async function processSmoothSlowMoBrowser(
  videoBlobUrl: string,
  speedFactor: number,
  onProgress: (progress: number) => void
): Promise<string> {
  const ffmpeg = new FFmpeg();
  
  ffmpeg.on("progress", ({ progress }) => {
    onProgress(progress * 100);
  });

  await ffmpeg.load({
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
  });

  const inputName = "input.mp4";
  const outputName = "output.mp4";

  await ffmpeg.writeFile(inputName, await fetchFile(videoBlobUrl));

  // Increase the frame rate by the inverse of speedFactor (e.g. 0.5 speed = 2x framerate = 60fps)
  // We cap targetFps at 120 so the browser/WASM doesn't crash on extreme slow-mo.
  const targetFps = Math.min(120, Math.round(30 / speedFactor));
  
  const filterString = `minterpolate=fps=${targetFps}:mi_mode=blend`;

  await ffmpeg.exec([
    "-i",
    inputName,
    "-filter:v",
    filterString,
    outputName,
  ]);

  const outputData = await ffmpeg.readFile(outputName);
  const outputBlob = new Blob([outputData], { type: "video/mp4" });
  return URL.createObjectURL(outputBlob);
}

