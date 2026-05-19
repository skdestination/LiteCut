/**
 * Optical Flow Integration Guide
 *
 * To achieve "buttery smooth" slow-motion using Frame Interpolation (Optical Flow),
 * you have two distinct architectural approaches:
 *
 * 1. Server-Side Processing (Recommended for high quality)
 * 2. Client-Side Processing (WASM / WebGL)
 *
 * ---
 * APPROACH 1: Server-Side Processing with FFmpeg (minterpolate)
 * ---
 * This is the easiest and most robust method. You send the trim boundaries and target speed
 * to a Node.js backend running `ffmpeg`, which uses the `minterpolate` filter.
 *
 * Requirements:
 * - Backend server (Express/Node.js)
 * - FFmpeg installed
 *
 * Integration:
 * ```typescript
 * import { exec } from "child_process";
 *
 * export function processSmoothSlowMo(inputPath: string, outputPath: string, speedFactor: number) {
 *    // speedFactor e.g., 0.25 (4x slower)
 *    const fps = 30;
 *    const targetFps = fps * (1 / speedFactor); // e.g., 120
 *
 *    // minterpolate:
 *    // mi_mode=mci (Motion Compensated Interpolation)
 *    // mc_mode=aobmc (Adaptive Overlapping Block Motion Compensation)
 *    // me_mode=bidir (Bidirectional Motion Estimation)
 *    const filterString = `minterpolate='fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1'`;
 *
 *    // Then apply setpts to actually stretch the video timestamps
 *    const setptsString = `setpts=${1 / speedFactor}*PTS`;
 *
 *    const cmd = `ffmpeg -i ${inputPath} -filter_complex "${filterString},${setptsString}" ${outputPath}`;
 *
 *    exec(cmd, (error, stdout, stderr) => {
 *        if(error) console.error("Error processing optical flow:", error);
 *        else console.log("Optical Flow interpolation complete!");
 *    });
 * }
 * ```
 *
 * ---
 * APPROACH 2: Client-Side with OpenCV.js (Dense Optical Flow)
 * ---
 * If processing must occur completely within the browser without a backend,
 * you can use OpenCV.js (`calcOpticalFlowFarneback`) to synthesize new frames on the CPU/WASM.
 *
 * Requirements:
 * - Load `opencv.js` via script tag or CDN.
 * - HTML5 Canvas or WebAudio/WebCodecs for frame extraction.
 *
 * Integration Steps:
 *
 * 1. Extract sequential frames (Frame A and Frame B) from an `<video>` element to canvases.
 * 2. Convert Canvas Data to OpenCV `cv.Mat`.
 * 3. Calculate Optical Flow vectors.
 * 4. Warp the pixels from Frame A and Frame B based on the flow, then blend.
 *
 * Example Algorithm:
 * ```typescript
 * // (Assuming cv is loaded from opencv.js)
 * export function interpolateFrames(prevFrameCanvas: HTMLCanvasElement, nextFrameCanvas: HTMLCanvasElement): HTMLCanvasElement {
 *     // 1. Read Image Data
 *     let matPrev = cv.imread(prevFrameCanvas);
 *     let matNext = cv.imread(nextFrameCanvas);
 *
 *     let prevGray = new cv.Mat();
 *     let nextGray = new cv.Mat();
 *
 *     // 2. Convert to Grayscale for Flow Calculation
 *     cv.cvtColor(matPrev, prevGray, cv.COLOR_RGBA2GRAY);
 *     cv.cvtColor(matNext, nextGray, cv.COLOR_RGBA2GRAY);
 *
 *     // 3. Compute Dense Optical Flow (Farneback)
 *     let flow = new cv.Mat();
 *     // Parameters: prev, next, flow, pyr_scale, levels, winsize, iterations, poly_n, poly_sigma, flags
 *     cv.calcOpticalFlowFarneback(prevGray, nextGray, flow, 0.5, 3, 15, 3, 5, 1.2, 0);
 *
 *     // 4. Warp Pixels to generate an intermediate frame (0.5 times distance)
 *     let flowOffset = new cv.Mat();
 *     flow.convertTo(flowOffset, cv.CV_32FC2, 0.5); // Multiply vectors by 0.5 for exactly middle frame
 *
 *     // Remap requires a map of coordinates (x, y) + flowOffset(x, y)
 *     let mapX = new cv.Mat(matPrev.rows, matPrev.cols, cv.CV_32FC1);
 *     let mapY = new cv.Mat(matPrev.rows, matPrev.cols, cv.CV_32FC1);
 *
 *     // Build deformation maps...
 *     for (let y = 0; y < matPrev.rows; y++) {
 *         for (let x = 0; x < matPrev.cols; x++) {
 *             let f = flowOffset.floatPtr(y, x);
 *             mapX.floatPtr(y, x)[0] = x + f[0];
 *             mapY.floatPtr(y, x)[0] = y + f[1];
 *         }
 *     }
 *
 *     let warpedFrame = new cv.Mat();
 *     // Warp Frame A forward
 *     cv.remap(matPrev, warpedFrame, mapX, mapY, cv.INTER_LINEAR);
 *
 *     // 5. Output to a new canvas
 *     let outputCanvas = document.createElement("canvas");
 *     cv.imshow(outputCanvas, warpedFrame);
 *
 *     // Cleanup
 *     matPrev.delete(); matNext.delete(); prevGray.delete(); nextGray.delete();
 *     flow.delete(); flowOffset.delete(); mapX.delete(); mapY.delete(); warpedFrame.delete();
 *
 *     return outputCanvas;
 * }
 * ```
 *
 * Note on Artifacts:
 * - Simple linear warping of flow can cause 'ghosting' or 'jelly' artifacts around occluded edges.
 * - Deep Learning models like RIFE (Real-Time Intermediate Flow Estimation) are much better.
 * - To use RIFE in the browser, you would need to export a trained ONNX model
 *   process it with `onnxruntime-web`, taking two frame tensors as input and outputting the intermediate tensor.
 */
