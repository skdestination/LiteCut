#include <jni.h>
#include <opencv2/opencv.hpp>
#include <opencv2/video/tracking.hpp>

using namespace cv;

extern "C"
JNIEXPORT void JNICALL
Java_com_litecut_app_slowmo_OpticalFlowEngine_interpolateFrame(
        JNIEnv *env, jobject thiz,
        jlong matAddrPrev, jlong matAddrNext, jlong matAddrOutput, jfloat timeOffset) {

    Mat &prev = *(Mat *) matAddrPrev;
    Mat &next = *(Mat *) matAddrNext;
    Mat &output = *(Mat *) matAddrOutput;

    Mat prevGray, nextGray;
    cvtColor(prev, prevGray, COLOR_RGBA2GRAY);
    cvtColor(next, nextGray, COLOR_RGBA2GRAY);

    // 1. Calculate Dense Optical Flow (Farneback)
    Mat flowForward, flowBackward;
    calcOpticalFlowFarneback(
            prevGray, nextGray, flowForward,
            0.5, 3, 15, 3, 5, 1.2, 0
    );
    calcOpticalFlowFarneback(
            nextGray, prevGray, flowBackward,
            0.5, 3, 15, 3, 5, 1.2, 0
    );

    // 2. Warp frames based on flow and timeOffset (0.0 -> 1.0)
    Mat mapXForward(flowForward.size(), CV_32FC1);
    Mat mapYForward(flowForward.size(), CV_32FC1);
    Mat mapXBackward(flowBackward.size(), CV_32FC1);
    Mat mapYBackward(flowBackward.size(), CV_32FC1);

    for (int y = 0; y < flowForward.rows; ++y) {
        for (int x = 0; x < flowForward.cols; ++x) {
            Point2f fForward = flowForward.at<Point2f>(y, x);
            Point2f fBackward = flowBackward.at<Point2f>(y, x);
            
            mapXForward.at<float>(y, x) = x + fForward.x * timeOffset;
            mapYForward.at<float>(y, x) = y + fForward.y * timeOffset;
            
            mapXBackward.at<float>(y, x) = x + fBackward.x * (1.0f - timeOffset);
            mapYBackward.at<float>(y, x) = y + fBackward.y * (1.0f - timeOffset);
        }
    }

    // Remap the previous frame forward
    Mat warpedPrev;
    remap(prev, warpedPrev, mapXForward, mapYForward, INTER_LINEAR, BORDER_REFLECT_101);

    // Remap the next frame backward
    Mat warpedNext;
    remap(next, warpedNext, mapXBackward, mapYBackward, INTER_LINEAR, BORDER_REFLECT_101);

    // Blend the two warped frames
    addWeighted(warpedPrev, 1.0 - timeOffset, warpedNext, timeOffset, 0.0, output);
}
