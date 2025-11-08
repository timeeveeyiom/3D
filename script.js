// 等待 HTML 載入完成
window.addEventListener('DOMContentLoaded', () => {

    // --- 1. 核心變數設定 ---
    
    // 3D 場景相關
    let scene, camera, renderer;
    // 臉部追蹤相關
    let model, video;
    // 用於平滑化座標
    const smoothingFactor = 0.1; // 越小越平滑，但延遲越高
    let smoothedHeadPos = { x: 0, y: 0, z: 0 };
    
    // 虛擬螢幕 (我們假設的"窗戶") 的參數
    // 這些值需要根據您的場景來微調
    const screenWidth = 1.5; // 虛擬螢幕的寬度 (3D 單位)
    const screenHeight = 1;  // 虛擬螢幕的高度 (3D 單位)
    const viewerZ = 2.5;     // 觀看者"眼睛"到螢幕的預設 Z 軸距離
    
    const loadingEl = document.getElementById('loading');

    // --- 2. 主程式啟動 ---
    async function main() {
        // 取得 HTML 元素
        const canvas = document.getElementById('c');
        video = document.getElementById('video');

        try {
            // 初始化攝影機和臉部模型
            await setupCamera();
            await loadFaceModel();
            
            // 初始化 3D 場景
            setupThreeJS(canvas);
            
            // 隱藏載入畫面
            loadingEl.style.opacity = '0';
            setTimeout(() => { loadingEl.style.display = 'none'; }, 500);

            // 開始主迴圈
            animate();

        } catch (error) {
            console.error("啟動失敗:", error);
            loadingEl.innerHTML = `<p>錯誤: ${error.message}<br><br>請確認您允許使用攝影機，並使用 https 或 localhost 環境。</p>`;
        }
    }

    // --- 3. 啟動網路攝影機 ---
    async function setupCamera() {
        // 取得影像串流
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: 640, 
                height: 480,
                facingMode: 'user' // 使用前置鏡頭
            },
            audio: false
        });
        
        video.srcObject = stream;
        
        // 等待影像載入完成
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve(video);
            };
        });
    }

    // --- 4. 載入 MediaPipe 臉部模型 ---
    async function loadFaceModel() {
        // 設定 TensorFlow.js 使用 WebGL 後端
        await tf.setBackend('webgl');
        
        // 載入模型
        // maxFaces: 1 表示我們只關心一個人的臉
        model = await faceLandmarksDetection.load(
            faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
            { maxFaces: 1 }
        );
        console.log("臉部模型載入完成");
    }

    // --- 5. 設定 Three.js 3D 場景 ---
    function setupThreeJS(canvas) {
        // 建立場景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a); // 深灰色背景

        // 建立渲染器
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        // 建立攝影機
        // **注意：** 我們使用 PerspectiveCamera，但我們將手動更新它的 'projectionMatrix'
        // fov 和 aspect 初始值不重要，因為它們會被覆蓋
        const near = 0.1;
        const far = 100;
        camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, near, far);
        
        // --- 在場景中加入一些物體 ---
        
        // A. 加入一個 "窗框" (幫助定位)
        const frameGeom = new THREE.BoxGeometry(screenWidth + 0.1, screenHeight + 0.1, 0.1);
        const frameMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
        const frame = new THREE.Mesh(frameGeom, frameMat);
        frame.position.z = -0.05; // 放在螢幕後面一點點
        scene.add(frame);

        // B. 在 "窗戶" 後面加入一堆方塊
        const boxGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        for (let i = 0; i < 50; i++) {
            const boxMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(`hsl(${Math.random() * 360}, 80%, 60%)`)
            });
            const box = new THREE.Mesh(boxGeom, boxMat);
            box.position.set(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 4 - 2 // 散佈在 Z 軸 -2 的位置
            );
            scene.add(box);
        }

        // C. 加入燈光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        
        const pointLight = new THREE.PointLight(0xffffff, 0.8);
        pointLight.position.set(1, 2, 3); // 燈光位置
        scene.add(pointLight);

        // 監聽視窗大小變化
        window.addEventListener('resize', onWindowResize);
        onWindowResize(); // 立即執行一次以設定初始大小
    }

    // --- 6. 視窗大小調整 ---
    function onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height);
        
        // 更新攝影機的 aspect，雖然我們會手動更新矩陣，但保持 aspect 正確是個好習慣
        camera.aspect = width / height;
        camera.updateProjectionMatrix(); // 更新標準矩陣 (雖然很快會被覆蓋)
    }

    // --- 7. 主動畫/偵測迴圈 ---
    async function animate() {
        // 請求下一幀動畫
        requestAnimationFrame(animate);

        // A. 偵測臉部
        if (model && video.readyState >= 3) { // 確保影像已準備好
            const predictions = await model.estimateFaces({
                input: video
            });

            if (predictions.length > 0) {
                // 我們只取第一張臉
                const keypoints = predictions[0].scaledMesh;
                
                // 取得鼻尖 (索引 1) 作為頭部中心點
                // keypoints[1] 回傳 [x, y, z] 座標
                // x: 影像中的 x 座標 (0 - 640)
                // y: 影像中的 y 座標 (0 - 480)
                // z: 深度 (數字越小表示離鏡頭越近)
                
                const [x_px, y_px, z_px] = keypoints[1];

                // B. **座標正規化**
                // 將像素座標轉換為 -1 到 1 的範圍 (中心為 0)
                // 我們反轉 x 軸，這樣您向右移，場景中的 "您" 也向右移 (符合鏡像)
                const normX = -(x_px / video.videoWidth - 0.5) * 2;
                const normY = -(y_px / video.videoHeight - 0.5) * 2;
                
                // Z 軸需要一點校準，這裡只做簡單的相對位移
                // z_px 通常是一個負值，我們取一個基準點 (例如 -100)
                const normZ = -(z_px + 100) * 0.02; // 調整 0.02 這個"靈敏度"
                
                // C. **座標平滑化 (Lerp)**
                // 減少抖動，使畫面更穩定
                smoothedHeadPos.x = THREE.MathUtils.lerp(smoothedHeadPos.x, normX, smoothingFactor);
                smoothedHeadPos.y = THREE.MathUtils.lerp(smoothedHeadPos.y, normY, smoothingFactor);
                smoothedHeadPos.z = THREE.MathUtils.lerp(smoothedHeadPos.z, normZ, smoothingFactor);

                // D. **更新攝影機 (核心邏輯)**
                updateCameraFrustum();
            }
        }
        
        // E. 渲染 3D 場景
        renderer.render(scene, camera);
    }
    
    // --- 8. 核心：更新非對稱視錐 (Asymmetric Frustum) ---
    function updateCameraFrustum() {
        // 取得平滑化後的頭部位置
        // 我們將 normX/Y 座標當作是在 3D 空間中的"位移"
        const headX = smoothedHeadPos.x * 0.5; // 乘以 0.5 降低靈敏度
        const headY = smoothedHeadPos.y * 0.5;
        // z 軸位移會影響"縮放"感
        const headZ = viewerZ + smoothedHeadPos.z * 1.5; 

        const near = camera.near;
        const far = camera.far;

        // --- 這是非對稱投影的關鍵數學 ---
        // 根據頭部位置 (headX, headY) 和 觀看距離 (headZ)，
        // 計算近裁剪平面 (near plane) 的四個邊界 (left, right, top, bottom)

        // (近平面寬度 / 遠平面寬度) = (近平面距離 / 遠平面距離)
        // (left / headX) = (near / headZ) => left = headX * (near / headZ)
        
        // 螢幕左側的 3D 座標
        const screenLeftEdge = -screenWidth / 2;
        // 螢幕右側的 3D 座標
        const screenRightEdge = screenWidth / 2;
        // 螢幕頂部的 3D 座標
        const screenTopEdge = screenHeight / 2;
        // 螢幕底部的 3D 座標
        const screenBottomEdge = -screenHeight / 2;

        // (left - headX) / (screenLeftEdge - headX) = near / headZ
        const left = (screenLeftEdge - headX) * (near / headZ);
        const right = (screenRightEdge - headX) * (near / headZ);
        const top = (screenTopEdge - headY) * (near / headZ);
        const bottom = (screenBottomEdge - headY) * (near / headZ);

        // 手動設定攝影機的投影矩陣
        camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
        
        // *非常重要*：必須設定為 true，three.js 才會在下一幀使用這個新矩陣
        camera.projectionMatrixUpdated = true;
    }


    // 啟動！
    main();
});