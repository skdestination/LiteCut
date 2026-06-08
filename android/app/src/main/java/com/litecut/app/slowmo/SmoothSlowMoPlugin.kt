package com.litecut.app.slowmo

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.opencv.core.Mat
import org.opencv.videoio.VideoCapture
import org.opencv.videoio.VideoWriter
import org.opencv.videoio.Videoio
import java.io.File

@CapacitorPlugin(name = "SmoothSlowMo")
class SmoothSlowMoPlugin : Plugin() {

    init {
        // Load the native C++ library compiled via CMake
        System.loadLibrary("frame_interpolator")
    }

    @PluginMethod
    fun processInterpolation(call: PluginCall) {
        val inputPath = call.getString("inputPath")
        val targetFps = call.getInt("targetFps", 30)
        val speedFactor = call.getFloat("speedFactor", 0.5f)

        if (inputPath == null) {
            call.reject("Must provide an input path.")
            return
        }

        // Dedicated secure storage directory in FilesDir (persists through app restarts)
        val slowMoDir = File(context.filesDir, "slow_motion_exports")
        if (!slowMoDir.exists()) {
            slowMoDir.mkdirs()
        }
        
        val outFile = File(slowMoDir, "interpolated_${System.currentTimeMillis()}.mp4")

        Thread {
            try {
                // Run heavy OpenCV processing on background thread
                val resultPath = runOpticalFlowPipeline(inputPath, outFile.absolutePath, targetFps, speedFactor)
                val ret = JSObject()
                ret.put("path", resultPath)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("SlowMo processing failed", e)
            }
        }.start()
    }

    private fun runOpticalFlowPipeline(inPath: String, outPath: String, targetFps: Int, speed: Float): String {
        val cap = VideoCapture(inPath)
        
        val width = cap.get(Videoio.CAP_PROP_FRAME_WIDTH).toInt()
        val height = cap.get(Videoio.CAP_PROP_FRAME_HEIGHT).toInt()

        // Setup hardware/software Writer (H264)
        val fourcc = VideoWriter.fourcc('H', '2', '6', '4')
        val writer = VideoWriter(outPath, fourcc, targetFps.toDouble(), org.opencv.core.Size(width.toDouble(), height.toDouble()))

        val prevFrame = Mat()
        val nextFrame = Mat()
        val interpolatedFrame = Mat()

        if (!cap.read(prevFrame)) {
            return ""
        }

        writer.write(prevFrame)

        // Basic extrapolation loop for 0.5x speed (1 intermediate frame)
        while (cap.read(nextFrame)) {
            // Synthesize the intermediate frame at time = 0.5
            OpticalFlowEngine.interpolateFrame(prevFrame.nativeObjAddr, nextFrame.nativeObjAddr, interpolatedFrame.nativeObjAddr, 0.5f)
            
            // Write intermediate synthesized frame
            writer.write(interpolatedFrame)
            // Write actual next frame
            writer.write(nextFrame)

            nextFrame.copyTo(prevFrame)
        }

        cap.release()
        writer.release()

        return outPath
    }
}

object OpticalFlowEngine {
    // Bridges to cpp/FrameInterpolator.cpp
    external fun interpolateFrame(prevMatAddr: Long, nextMatAddr: Long, outMatAddr: Long, timeOffset: Float)
}
