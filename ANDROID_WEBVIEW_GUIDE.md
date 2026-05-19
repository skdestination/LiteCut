# Android WebView & WebIntoApp Setup Guide

To prevent WebView crashes and fix behavior on fully wrapped mobile native apps, you must apply the following Android configurations in your builder (like WebIntoApp or Android Studio).

## 1. Request Native Permissions
Add these inside your `AndroidManifest.xml` (above the `<application>` tag):

```xml
<!-- Required for saving videos and accessing media/images -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

<!-- Required for Camera features if applicable -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

## 2. Enable Hardware Acceleration
In your `AndroidManifest.xml`, make sure Hardware Acceleration is enabled to avoid WebView WebGL and Animation crashes.

```xml
<application
    ...
    android:hardwareAccelerated="true">
```

## 3. WebView Safe Settings (Java / Kotlin)
If modifying Source Code, ensure the WebView gives enough quota and file read permissions by explicitly overriding WebSettings.

```java
WebSettings webSettings = webView.getSettings();

// Memory & Rendering Optimization
webSettings.setDomStorageEnabled(true);
webSettings.setDatabaseEnabled(true);
webSettings.setAppCacheEnabled(true);
webSettings.setRenderPriority(WebSettings.RenderPriority.HIGH);
webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

// File Permissions
webSettings.setAllowFileAccess(true);
webSettings.setAllowFileAccessFromFileURLs(true);
webSettings.setAllowUniversalAccessFromFileURLs(true);
webSettings.setAllowContentAccess(true);

// Hardware Acceleration explicitly on WebView
webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
```

## 4. Disable Pull-to-Refresh in App Builder
Although the front-end now contains robust JavaScript protection against `pull-to-refresh` natively on Chrome/Safari (`touchmove` preventDefault + exception catching), **some native app wrappers intercept the touch gesture BEFORE the WebView**. 

* If you are still experiencing refreshes when pulling down, you **MUST disable "Swipe to Refresh" or "Pull to Refresh"** inside the WebIntoApp.com settings dashboard before building the APK.

## 5. Hide Title / Action Bar (Immersive Fullscreen)
Inside `res/values/styles.xml`, ensure your app's base theme has no action bar:

```xml
<style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="windowActionBar">false</item>
    <item name="windowNoTitle">true</item>
    <!-- Make Status Bar Transparent / Black Translucent -->
    <item name="android:statusBarColor">#0f0f11</item>
</style>
```
