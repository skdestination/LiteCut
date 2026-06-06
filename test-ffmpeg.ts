import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
ffmpeg.load().then(() => {
  console.log("FFmpeg loaded!");
  process.exit(0);
}).catch(console.error);
