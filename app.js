(() => {
  const qs = (s) => document.querySelector(s);
  const on = (el, ev, cb) => el.addEventListener(ev, cb);

  const fileInput = qs('#fileInput');
  const btnReset = qs('#btnReset');
  const btnDownload = qs('#btnDownload');
  const presetPassport = qs('#presetPassport');
  const toggleSplit = qs('#toggleSplit');
  const statusEl = qs('#status');

  const canvasSrc = qs('#canvasSrc');
  const canvasDst = qs('#canvasDst');
  const ctxSrc = canvasSrc.getContext('2d');
  const ctxDst = canvasDst.getContext('2d');

  const sBrightness = qs('#sliderBrightness');
  const sContrast = qs('#sliderContrast');
  const sClarity = qs('#sliderClarity');
  const sSmooth = qs('#sliderSmooth');
  const sSkin = qs('#sliderSkin');
  const sWB = qs('#sliderWB');
  const vBrightness = qs('#valBrightness');
  const vContrast = qs('#valContrast');
  const vClarity = qs('#valClarity');
  const vSmooth = qs('#valSmooth');
  const vSkin = qs('#valSkin');
  const vWB = qs('#valWB');

  const state = {
    srcImage: null,
    srcMat: null,
    workingMat: null,
    splitView: false,
    params: { brightness: 0, contrast: 0, clarity: 0, smooth: 0, skin: 0, wb: 0 },
    aiEnabled: false,
    detectedFaces: [],
    autoEnhanceApplied: false
  };

  function enableControls(enabled) {
    [btnReset, btnDownload, presetPassport, toggleSplit, sBrightness, sContrast, sClarity, sSmooth, sSkin, sWB]
      .forEach(el => el.disabled = !enabled);
  }

  function fitCanvasToImage(img) {
    const maxSide = 1024;
    const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    [canvasSrc, canvasDst].forEach(c => { c.width = w; c.height = h; });
  }

  function drawOriginal() {
    if (!state.srcImage) return;
    ctxSrc.clearRect(0, 0, canvasSrc.width, canvasSrc.height);
    ctxSrc.drawImage(state.srcImage, 0, 0, canvasSrc.width, canvasSrc.height);
  }

  function readCanvasToMat(canvas) {
    const imgData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const mat = cv.matFromImageData(imgData);
    return mat;
  }

  function writeMatToCanvas(mat, canvas) {
    const imgData = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
    canvas.getContext('2d').putImageData(imgData, 0, 0);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===== AI FUNCTIONS =====
  
  // كشف الوجوه باستخدام OpenCV
  function detectFaces(imageMat) {
    if (!cv) return [];
    
    try {
      // طريقة 1: كشف بناءً على ألوان البشرة
      let faces = detectFacesBySkinColor(imageMat);
      
      if (faces.length > 0) {
        return faces;
      }
      
      // طريقة 2: كشف بناءً على الشكل
      return detectFacesByShape(imageMat);
      
    } catch (error) {
      console.log('Face detection error:', error);
      // إرجاع وجه افتراضي في وسط الصورة للاختبار
      return [{
        x: Math.floor(imageMat.cols * 0.25),
        y: Math.floor(imageMat.rows * 0.25),
        width: Math.floor(imageMat.cols * 0.5),
        height: Math.floor(imageMat.rows * 0.5)
      }];
    }
  }

  // كشف الوجوه بناءً على ألوان البشرة
  function detectFacesBySkinColor(imageMat) {
    try {
      // تحويل إلى HSV للكشف عن ألوان البشرة
      let hsv = new cv.Mat();
      cv.cvtColor(imageMat, hsv, cv.COLOR_BGR2HSV);
      
      // نطاق ألوان البشرة في HSV
      let lowerSkin = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, 20, 70));
      let upperSkin = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(20, 255, 255));
      
      // إنشاء قناع للبشرة
      let skinMask = new cv.Mat();
      cv.inRange(hsv, lowerSkin, upperSkin, skinMask);
      
      // تنظيف القناع
      let kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      cv.morphologyEx(skinMask, skinMask, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(skinMask, skinMask, cv.MORPH_CLOSE, kernel);
      
      // العثور على الكنتورات
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(skinMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      let faces = [];
      for (let i = 0; i < contours.size(); i++) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        // تصفية المناطق الصغيرة والكبيرة
        if (area > 2000 && area < (imageMat.rows * imageMat.cols) * 0.4) {
          let rect = cv.boundingRect(contour);
          let aspectRatio = rect.width / rect.height;
          
          // الوجوه عادة لها نسبة عرض إلى ارتفاع معقولة
          if (aspectRatio > 0.6 && aspectRatio < 1.5) {
            faces.push({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            });
          }
        }
        contour.delete();
      }
      
      // تنظيف الذاكرة
      hsv.delete();
      lowerSkin.delete();
      upperSkin.delete();
      skinMask.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
      
      return faces;
    } catch (error) {
      console.log('Skin color detection error:', error);
      return [];
    }
  }

  // كشف الوجوه بناءً على الشكل
  function detectFacesByShape(imageMat) {
    try {
      // تحويل إلى تدرج رمادي
      let gray = new cv.Mat();
      cv.cvtColor(imageMat, gray, cv.COLOR_BGR2GRAY);
      
      // تحسين التباين
      let equalized = new cv.Mat();
      cv.equalizeHist(gray, equalized);
      
      // كشف الحواف
      let edges = new cv.Mat();
      cv.Canny(equalized, edges, 50, 150);
      
      // العثور على الكنتورات
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      let faces = [];
      for (let i = 0; i < contours.size(); i++) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        // تصفية المناطق الصغيرة والكبيرة
        if (area > 1000 && area < (imageMat.rows * imageMat.cols) * 0.3) {
          let rect = cv.boundingRect(contour);
          let aspectRatio = rect.width / rect.height;
          
          // الوجوه عادة لها نسبة عرض إلى ارتفاع بين 0.7 و 1.3
          if (aspectRatio > 0.7 && aspectRatio < 1.3) {
            faces.push({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            });
          }
        }
        contour.delete();
      }
      
      // تنظيف الذاكرة
      gray.delete();
      equalized.delete();
      edges.delete();
      contours.delete();
      hierarchy.delete();
      
      return faces;
    } catch (error) {
      console.log('Shape detection error:', error);
      return [];
    }
  }

  // تحليل جودة الصورة
  function analyzeImageQuality(imageMat) {
    let gray = new cv.Mat();
    cv.cvtColor(imageMat, gray, cv.COLOR_BGR2GRAY);
    
    // حساب التباين
    let mean = new cv.Mat();
    let stddev = new cv.Mat();
    cv.meanStdDev(gray, mean, stddev);
    const contrast = stddev.data64F[0];
    
    // حساب الحدة (Laplacian variance)
    let laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    let meanLap = new cv.Mat();
    let stddevLap = new cv.Mat();
    cv.meanStdDev(laplacian, meanLap, stddevLap);
    const sharpness = stddevLap.data64F[0];
    
    // حساب السطوع
    const brightness = mean.data64F[0];
    
    // تنظيف الذاكرة
    gray.delete();
    mean.delete();
    stddev.delete();
    laplacian.delete();
    meanLap.delete();
    stddevLap.delete();
    
    return {
      contrast: Math.round(contrast),
      sharpness: Math.round(sharpness),
      brightness: Math.round(brightness),
      quality: contrast > 30 && sharpness > 100 ? 'جيد' : 'يحتاج تحسين'
    };
  }

  // التحسين التلقائي للصور
  function autoEnhanceImage(imageMat) {
    const quality = analyzeImageQuality(imageMat);
    const enhancements = {};
    
    // تحسين السطوع
    if (quality.brightness < 80) {
      enhancements.brightness = Math.min(50, 100 - quality.brightness);
    } else if (quality.brightness > 180) {
      enhancements.brightness = Math.max(-30, 150 - quality.brightness);
    }
    
    // تحسين التباين
    if (quality.contrast < 30) {
      enhancements.contrast = Math.min(40, 60 - quality.contrast);
    }
    
    // تحسين الوضوح
    if (quality.sharpness < 100) {
      enhancements.clarity = Math.min(50, 150 - quality.sharpness);
    }
    
    // تحسين تليين البشرة إذا كان هناك وجوه
    if (state.detectedFaces.length > 0) {
      enhancements.skin = 25;
      enhancements.smooth = 15;
    }
    
    return enhancements;
  }

  // تطبيق التحسين التلقائي
  function applyAutoEnhance() {
    if (!state.srcMat || state.autoEnhanceApplied) return;
    
    console.log('🔍 بدء التحليل الذكي...');
    
    // كشف الوجوه
    state.detectedFaces = detectFaces(state.srcMat);
    console.log('👤 الوجوه المكتشفة:', state.detectedFaces.length, state.detectedFaces);
    
    // تحليل الجودة
    const quality = analyzeImageQuality(state.srcMat);
    console.log('📊 جودة الصورة:', quality);
    
    // عرض معلومات التحليل
    displayAIAnalysis(quality);
    
    // الحصول على التحسينات المقترحة
    const enhancements = autoEnhanceImage(state.srcMat);
    console.log('⚙️ التحسينات المقترحة:', enhancements);
    
    // تطبيق التحسينات
    let appliedCount = 0;
    Object.keys(enhancements).forEach(key => {
      if (enhancements[key] !== 0) {
        state.params[key] = enhancements[key];
        // تحديث المنزلقات
        const slider = qs(`#slider${key.charAt(0).toUpperCase() + key.slice(1)}`);
        if (slider) slider.value = enhancements[key];
        appliedCount++;
      }
    });
    
    state.autoEnhanceApplied = true;
    refresh();
    
    // إظهار النتائج للمستخدم
    statusEl.textContent = `✅ تم التحليل والتحسين التلقائي - الجودة: ${quality.quality} - الوجوه: ${state.detectedFaces.length} - التحسينات: ${appliedCount}`;
    console.log('✅ انتهى التحليل الذكي');
  }

  // عرض معلومات التحليل الذكي
  function displayAIAnalysis(quality) {
    const aiSection = qs('#aiAnalysis');
    console.log('🔍 البحث عن قسم التحليل:', aiSection);
    
    if (aiSection) {
      aiSection.style.display = 'block';
      console.log('✅ تم إظهار قسم التحليل');
      
      // تحديث القيم
      const brightnessEl = qs('#aiBrightness');
      const contrastEl = qs('#aiContrast');
      const sharpnessEl = qs('#aiSharpness');
      const qualityEl = qs('#aiQuality');
      const facesEl = qs('#aiFaces');
      
      console.log('🔍 البحث عن العناصر:', {
        brightness: brightnessEl,
        contrast: contrastEl,
        sharpness: sharpnessEl,
        quality: qualityEl,
        faces: facesEl
      });
      
      if (brightnessEl) {
        brightnessEl.textContent = quality.brightness || 'غير محدد';
        console.log('✅ تم تحديث السطوع:', quality.brightness);
      }
      if (contrastEl) {
        contrastEl.textContent = quality.contrast || 'غير محدد';
        console.log('✅ تم تحديث التباين:', quality.contrast);
      }
      if (sharpnessEl) {
        sharpnessEl.textContent = quality.sharpness || 'غير محدد';
        console.log('✅ تم تحديث الوضوح:', quality.sharpness);
      }
      if (qualityEl) {
        qualityEl.textContent = quality.quality || 'غير محدد';
        console.log('✅ تم تحديث الجودة:', quality.quality);
      }
      if (facesEl) {
        facesEl.textContent = state.detectedFaces.length || '0';
        console.log('✅ تم تحديث الوجوه:', state.detectedFaces.length);
      }
      
      // إضافة رسالة توضيحية إذا لم تكن هناك نتائج
      if (!quality.brightness && !quality.contrast && !quality.sharpness) {
        const qualityInfo = qs('#qualityInfo');
        if (qualityInfo && !qs('#noDataMessage')) {
          const noDataMsg = document.createElement('div');
          noDataMsg.id = 'noDataMessage';
          noDataMsg.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #ff9800; font-style: italic; margin-top: 10px;';
          noDataMsg.textContent = '⚠️ لم يتم تحليل الصورة بعد - تأكد من تحميل صورة صحيحة';
          qualityInfo.appendChild(noDataMsg);
        }
      }
    } else {
      console.error('❌ لم يتم العثور على قسم التحليل الذكي!');
    }
  }

  // فلتر ذكي للبشرة
  function applySmartSkinFilter(imageMat) {
    if (state.detectedFaces.length === 0) return imageMat;
    
    let result = imageMat.clone();
    
    state.detectedFaces.forEach(face => {
      // تحديد منطقة الوجه
      let faceROI = new cv.Rect(
        Math.max(0, face.x - face.width * 0.1),
        Math.max(0, face.y - face.height * 0.1),
        Math.min(imageMat.cols - face.x, face.width * 1.2),
        Math.min(imageMat.rows - face.y, face.height * 1.2)
      );
      
      // استخراج منطقة الوجه
      let faceRegion = result.roi(faceROI);
      
      // تطبيق تمويه ناعم
      let blurred = new cv.Mat();
      cv.GaussianBlur(faceRegion, blurred, new cv.Size(15, 15), 0);
      
      // دمج النتيجة
      blurred.copyTo(faceRegion);
      
      // تنظيف الذاكرة
      faceRegion.delete();
      blurred.delete();
    });
    
    return result;
  }

  function applyEdits() {
    if (!state.srcMat) return;

    let src = state.srcMat; // RGBA
    let bgr = new cv.Mat();
    cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);

    // تطبيق الفلتر الذكي للبشرة إذا كان مفعلاً
    if (state.aiEnabled && state.detectedFaces.length > 0) {
      bgr = applySmartSkinFilter(bgr);
    }

    // White balance: simple gray-world scaling
    if (state.params.wb !== 0) {
      let channels = new cv.MatVector();
      cv.split(bgr, channels);
      const means = [cv.mean(channels.get(0))[0], cv.mean(channels.get(1))[0], cv.mean(channels.get(2))[0]]; // B,G,R
      const avg = (means[0] + means[1] + means[2]) / 3;
      const k = state.params.wb / 50; // -1..1
      for (let i = 0; i < 3; i++) {
        const scale = 1 + k * (avg - means[i]) / 128;
        cv.multiply(channels.get(i), new cv.Scalar(scale), channels.get(i));
      }
      cv.merge(channels, bgr);
      channels.delete();
    }

    // Smoothing (bilateral)
    let smoothed = new cv.Mat();
    if (state.params.smooth > 0) {
      const d = clamp(Math.round(3 + state.params.smooth), 3, 25);
      const sigmaColor = 25 + state.params.smooth * 4;
      const sigmaSpace = 12 + state.params.smooth * 2;
      cv.bilateralFilter(bgr, smoothed, d, sigmaColor, sigmaSpace, cv.BORDER_DEFAULT);
    } else {
      smoothed = bgr.clone();
    }

    // Skin soften (guided by YCrCb mask)
    let softened = new cv.Mat();
    if (state.params.skin > 0) {
      let ycrcb = new cv.Mat();
      cv.cvtColor(smoothed, ycrcb, cv.COLOR_BGR2YCrCb);
      let ch = new cv.MatVector();
      cv.split(ycrcb, ch);
      let Cr = ch.get(1), Cb = ch.get(2);
      let skinMask = new cv.Mat();
      // Simple skin range
      cv.inRange(new cv.MatVector(), new cv.Scalar(0, 133, 77), new cv.Scalar(255, 173, 127));
      // Workaround: build from YCrCb directly
      let low = new cv.Mat(ycrcb.rows, ycrcb.cols, ycrcb.type(), new cv.Scalar(0, 133, 77));
      let high = new cv.Mat(ycrcb.rows, ycrcb.cols, ycrcb.type(), new cv.Scalar(255, 173, 127));
      cv.inRange(ycrcb, low, high, skinMask);
      cv.GaussianBlur(skinMask, skinMask, new cv.Size(9, 9), 0);
      let blur = new cv.Mat();
      const k = 3 + Math.round(state.params.skin / 10) * 2;
      cv.GaussianBlur(smoothed, blur, new cv.Size(k, k), 0);
      softened = smoothed.clone();
      blur.copyTo(softened, skinMask);
      [ycrcb, ch, Cr, Cb, skinMask, blur, low, high].forEach(m => m.delete && m.delete());
    } else {
      softened = smoothed.clone();
    }

    // Brightness/Contrast: dst = alpha * img + beta
    let bc = new cv.Mat();
    const alpha = 1 + state.params.contrast / 100; // 0..2
    const beta = state.params.brightness; // -100..100
    softened.convertTo(bc, -1, alpha, beta);

    // Clarity: unsharp masking
    let sharp = new cv.Mat();
    if (state.params.clarity > 0) {
      let blur2 = new cv.Mat();
      const radius = 1 + Math.round(state.params.clarity / 40) * 2;
      cv.GaussianBlur(bc, blur2, new cv.Size(radius, radius), 0);
      const amount = state.params.clarity / 100; // 0..2
      cv.addWeighted(bc, 1 + amount, blur2, -amount, 0, sharp);
      blur2.delete();
    } else {
      sharp = bc.clone();
    }

    // Convert back to RGBA
    let rgba = new cv.Mat();
    cv.cvtColor(sharp, rgba, cv.COLOR_BGR2RGBA);
    writeMatToCanvas(rgba, canvasDst);

    // Cleanup
    [bgr, smoothed, softened, bc, sharp, rgba].forEach(m => m.delete && m.delete());
  }

  function refresh() {
    vBrightness.textContent = String(state.params.brightness);
    vContrast.textContent = String(state.params.contrast);
    vClarity.textContent = String(state.params.clarity);
    vSmooth.textContent = String(state.params.smooth);
    vSkin.textContent = String(state.params.skin);
    vWB.textContent = String(state.params.wb);
    applyEdits();
  }

  function handleImage(file) {
    const img = new Image();
    img.onload = () => {
      state.srcImage = img;
      fitCanvasToImage(img);
      drawOriginal();
      if (state.srcMat) { state.srcMat.delete(); state.srcMat = null; }
      state.srcMat = readCanvasToMat(canvasSrc);
      
      // إعادة تعيين حالة الذكاء الاصطناعي
      state.autoEnhanceApplied = false;
      state.detectedFaces = [];
      
      enableControls(true);
      statusEl.textContent = 'جاهز - اضغط "تفعيل الذكاء الاصطناعي" للتحليل التلقائي';
      refresh();
    };
    const url = URL.createObjectURL(file);
    img.src = url;
  }

  function resetEdits() {
    state.params = { brightness: 0, contrast: 0, clarity: 0, smooth: 0, skin: 0, wb: 0 };
    sBrightness.value = 0; sContrast.value = 0; sClarity.value = 0; sSmooth.value = 0; sSkin.value = 0; sWB.value = 0;
    state.autoEnhanceApplied = false;
    state.detectedFaces = [];
    drawOriginal();
    state.srcMat?.delete?.();
    state.srcMat = readCanvasToMat(canvasSrc);
    refresh();
  }

  function download() {
    const a = document.createElement('a');
    a.download = 'صورة_معدلة.jpg';
    a.href = canvasDst.toDataURL('image/jpeg', 0.95);
    a.click();
  }

  function applyPassportPreset() {
    state.params = {
      brightness: 10,
      contrast: 15,
      clarity: 25,
      smooth: 8,
      skin: 35,
      wb: 6
    };
    sBrightness.value = state.params.brightness;
    sContrast.value = state.params.contrast;
    sClarity.value = state.params.clarity;
    sSmooth.value = state.params.smooth;
    sSkin.value = state.params.skin;
    sWB.value = state.params.wb;
    refresh();
  }

  // تبديل الذكاء الاصطناعي
  function toggleAI() {
    state.aiEnabled = !state.aiEnabled;
    const aiBtn = qs('#btnAI');
    const aiSection = qs('#aiAnalysis');
    
    console.log('🔄 تبديل الذكاء الاصطناعي:', state.aiEnabled);
    console.log('🔍 زر الذكاء الاصطناعي:', aiBtn);
    console.log('🔍 قسم التحليل:', aiSection);
    
    if (aiBtn) {
      aiBtn.textContent = state.aiEnabled ? 'إيقاف الذكاء الاصطناعي' : 'تفعيل الذكاء الاصطناعي';
      aiBtn.style.backgroundColor = state.aiEnabled ? '#4CAF50' : '#2196F3';
    }
    
    if (aiSection) {
      aiSection.style.display = state.aiEnabled ? 'block' : 'none';
      console.log('✅ تم تحديث عرض القسم:', aiSection.style.display);
    } else {
      console.error('❌ لم يتم العثور على قسم التحليل!');
    }
    
    if (state.aiEnabled && state.srcMat) {
      applyAutoEnhance();
    } else if (state.aiEnabled) {
      statusEl.textContent = 'الذكاء الاصطناعي مفعل - افتح صورة لرؤية التحليل التلقائي';
    } else {
      statusEl.textContent = 'الذكاء الاصطناعي معطل';
    }
  }

  // UI events
  on(fileInput, 'change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImage(file);
  });

  on(btnReset, 'click', resetEdits);
  on(btnDownload, 'click', download);
  on(presetPassport, 'click', applyPassportPreset);
  
  // إضافة مستمع للذكاء الاصطناعي
  const btnAI = qs('#btnAI');
  if (btnAI) {
    on(btnAI, 'click', toggleAI);
  }

  [
    [sBrightness, 'brightness'],
    [sContrast, 'contrast'],
    [sClarity, 'clarity'],
    [sSmooth, 'smooth'],
    [sSkin, 'skin'],
    [sWB, 'wb']
  ].forEach(([slider, key]) => {
    on(slider, 'input', (e) => {
      state.params[key] = Number(e.target.value);
      refresh();
    });
  });

  // OpenCV ready
  function onOpenCvReady() {
    statusEl.textContent = '✅ تم تحميل OpenCV. افتح صورة لبدء التحرير.';
  }

  // opencv.js calls Module.onRuntimeInitialized when ready
  window.Module = { onRuntimeInitialized: onOpenCvReady };
  
  // دالة اختبار إظهار قسم التحليل
  window.testAISection = function() {
    console.log('🧪 اختبار قسم التحليل الذكي...');
    const aiSection = qs('#aiAnalysis');
    if (aiSection) {
      aiSection.style.display = 'block';
      console.log('✅ تم إظهار القسم بنجاح');
      
      // تحديث القيم التجريبية
      const brightnessEl = qs('#aiBrightness');
      const contrastEl = qs('#aiContrast');
      const sharpnessEl = qs('#aiSharpness');
      const qualityEl = qs('#aiQuality');
      const facesEl = qs('#aiFaces');
      
      if (brightnessEl) brightnessEl.textContent = '120';
      if (contrastEl) contrastEl.textContent = '45';
      if (sharpnessEl) sharpnessEl.textContent = '150';
      if (qualityEl) qualityEl.textContent = 'جيد';
      if (facesEl) facesEl.textContent = '1';
      
      console.log('✅ تم تحديث القيم التجريبية');
    } else {
      console.error('❌ لم يتم العثور على قسم التحليل!');
    }
  };
})();


