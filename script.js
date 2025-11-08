// 等待 HTML 載入完成
window.addEventListener('DOMContentLoaded', () => {

    // --- 1. 核心變數設定 (新增變數) ---
    let scene, camera, renderer, composer; // composer 用於後期處理 (景深)
    let model, video;
    const smoothingFactor = 0.1;
    let smoothedHeadPos = { x: 0, y: 0, z: 0 };
    
    // 虛擬螢幕參數 (微調，靈敏度更高)
    const screenWidth = 1.5;
    const screenHeight = 1;
    const viewerZ = 1.8; // 觀看者到螢幕距離拉近，增強視差
    
    const loadingEl = document.getElementById('loading');
    
    // --- 2. 場景優化相關變數 ---
    const DEPTH_FOG_COLOR = 0x222233; // 背景霧氣顏色
    let foregroundObjects = []; // 用於景深控制的近處物體

    // ... (main, setupCamera, loadFaceModel, onWindowResize 函式保持不變) ...


    // --- 3. 設定 Three.js 3D 場景 (大幅優化) ---
    function setupThreeJS(canvas) {
        // 建立場景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000); // 純黑背景
        
        // 【優化 4: 多層深度背景 (霧氣)】
        scene.fog = new THREE.Fog(DEPTH_FOG_COLOR, 5, 20); // 從 Z=5 開始，到 Z=20 變成完全模糊/背景色

        // 建立渲染器 (必須啟用陰影貼圖)
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        
        // 啟用陰影貼圖 (必須步驟)
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 柔和陰影

        // 後期處理 (景深)
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));

        // FXAA Pass (可選，用於抗鋸齒，讓邊緣更平滑)
        const fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
        const pixelRatio = renderer.getPixelRatio();
        fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
        fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
        composer.addPass(fxaaPass);
        
        // 景深處理 (複雜，此處用簡單方式模擬，見下文的物體材質)
        
        // 建立攝影機
        const near = 0.1;
        const far = 100;
        camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, near, far);
        
        // --- 在場景中加入物體 ---
        
        // A. 窗框 (不變)
        const frameGeom = new THREE.BoxGeometry(screenWidth + 0.1, screenHeight + 0.1, 0.1);
        const frameMat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.2 });
        const frame = new THREE.Mesh(frameGeom, frameMat);
        frame.position.z = -0.05;
        scene.add(frame);
        
        // B. 地面 (接收陰影)
        const planeGeom = new THREE.PlaneGeometry(10, 10);
        // 【優化 2: 反射材質】使用 MeshStandardMaterial 來接收陰影和環境反射
        const planeMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8, metalness: 0.1 });
        const plane = new THREE.Mesh(planeGeom, planeMat);
        plane.rotation.x = -Math.PI / 2; // 旋轉 90 度
        plane.position.y = -0.5;
        plane.receiveShadow = true; // 設置接收陰影
        scene.add(plane);

        // C. 方塊陣列
        const boxGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        for (let i = 0; i < 50; i++) {
            // 【優化 2: 反射材質】
            const boxMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(`hsl(${Math.random() * 360}, 80%, 60%)`),
                roughness: 0.5, // 粗糙度
                metalness: 0.2  // 金屬感
            });
            const box = new THREE.Mesh(boxGeom, boxMat);
            box.position.set(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 8 - 4 // Z 軸分佈更廣 (Z=-8 到 Z=0)
            );
            box.castShadow = true;   // 設置投射陰影
            box.receiveShadow = true; // 設置接收陰影
            scene.add(box);
            if (box.position.z > -1) { // 將靠近螢幕的物體加入清單
                foregroundObjects.push(box);
            }
        }

        // D. 燈光 (投射陰影)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // 柔和環境光
        scene.add(ambientLight);
        
        // 【優化 2: 立體柔和陰影】使用 DirectionalLight 或 SpotLight
        const spotLight = new THREE.SpotLight(0xffffff, 1.5);
        spotLight.position.set(5, 10, 5); // 燈光位置
        spotLight.castShadow = true; // 啟用陰影投射

        // 調整陰影參數使陰影更柔和 (軟陰影)
        spotLight.shadow.mapSize.width = 1024;
        spotLight.shadow.mapSize.height = 1024;
        spotLight.shadow.camera.near = 0.5;
        spotLight.shadow.camera.far = 50;
        spotLight.shadow.bias = -0.0001; // 輕微偏移消除摩爾紋
        
        scene.add(spotLight);
        
        // 【優化 4: 多層深度背景 (遠處光點/星空)】
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        for (let i = 0; i < 500; i++) {
            // 讓光點分佈在非常遙遠的背景 (Z=-30 到 Z=-10)
            vertices.push(
                (Math.random() - 0.5) * 50, // X
                (Math.random() - 0.5) * 50, // Y
                (Math.random() * 20) - 30   // Z (從 -30 到 -10)
            );
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const material = new THREE.PointsMaterial({ color: 0x8888aa, size: 0.1, transparent: true, opacity: 0.6 });
        const points = new THREE.Points(geometry, material);
        scene.add(points);

        // 監聽視窗大小變化
        window.addEventListener('resize', onWindowResize);
        onWindowResize();
    }
    
    // 調整 onWindowResize 以適應 composer
    function onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height);
        composer.setSize(width, height); // 更新 composer
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        // 更新 FXAA Pass 的 resolution
        const pixelRatio = renderer.getPixelRatio();
        composer.passes[1].material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
        composer.passes[1].material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);
    }


    // --- 4. 主動畫/偵測迴圈 (調整渲染方式) ---
    async function animate() {
        requestAnimationFrame(animate);

        // A. 臉部偵測 (與之前相同)
        if (model && video.readyState >= 3) {
            // ... (臉部追蹤邏輯不變)
            const predictions = await model.estimateFaces({ input: video });
            if (predictions.length > 0) {
                const keypoints = predictions[0].scaledMesh;
                const [x_px, y_px, z_px] = keypoints[1];
                const normX = -(x_px / video.videoWidth - 0.5) * 2;
                const normY = -(y_px / video.videoHeight - 0.5) * 2;
                const normZ = -(z_px + 100) * 0.02; 
                
                smoothedHeadPos.x = THREE.MathUtils.lerp(smoothedHeadPos.x, normX, smoothingFactor);
                smoothedHeadPos.y = THREE.MathUtils.lerp(smoothedHeadPos.y, normY, smoothingFactor);
                smoothedHeadPos.z = THREE.MathUtils.lerp(smoothedHeadPos.z, normZ, smoothingFactor);

                updateCameraFrustum();
            }
        }
        
        // B. **【優化 1: 景深模糊】模擬**
        // 這裡我們不使用複雜的 DoF Shader，而是透過調整物體的透明度來模擬
        // 讓距離 (Z軸) 越遠的物體，顏色越深、越融入霧氣 (scene.fog)
        scene.traverse((object) => {
            if (object.isMesh && object.material.isMeshStandardMaterial) {
                 // 根據物體與攝影機的距離調整透明度和顏色
                 const distance = object.position.z;
                 // 距離越遠 (-4), 顏色越暗淡
                 const darknessFactor = 1 - Math.min(1, Math.max(0, (distance + 4) / 4));
                 object.material.color.setScalar(darknessFactor * 0.5 + 0.5); // 讓顏色變暗
                 object.material.needsUpdate = true;
            }
        });
        
        // C. 渲染 (改用 composer 渲染)
        // 使用 composer.render() 取代 renderer.render()
        composer.render();
    }
    
    // ... (updateCameraFrustum 函式保持不變，參數已在 setupThreeJS 調整) ...


    main();
});
