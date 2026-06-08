cmake_minimum_required(VERSION 3.18.1)

project("frame_interpolator")

# OpenCV Integration
set(OpenCV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../opencv/sdk/native/jni)
find_package(OpenCV REQUIRED)

add_library(
        frame_interpolator
        SHARED
        FrameInterpolator.cpp
)

target_link_libraries(frame_interpolator ${OpenCV_LIBS} log)
