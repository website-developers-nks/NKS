
class TradingVisualization {
  constructor(container) {
    this.container = container;
    this.width = Math.max(container.offsetWidth, 100);
    this.height = Math.max(container.offsetHeight, 100);
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetRotationX = 0;
    this.targetRotationY = 0;
    this.isDragging = false;
    this.previousMouseX = 0;
    this.previousMouseY = 0;
    this.dragRotationX = 0;
    this.dragRotationY = 0;

    this.blueColor = 0x243d93;
    this.greenColor = 0x64a443;

    this.blueColorLight = 0x1a2d6b;
    this.greenColorLight = 0x3d7a28;

    this.fogColorDark = 0x0a0a0a;
    this.fogColorLight = 0xf8f7f4;

    this.lastInteractionTime = Date.now();
    this.idleDelay = 2000;
    this.axisChangeInterval = 5000;
    this.lastAxisChangeTime = Date.now();
    this.randomAxis = this.getRandomAxis();
    this.autoSpinSpeed = 0.02;

    this.init();
    this.createSpheres();
    this.createGeometry();

    this.animate();
    this.addEventListeners();
    this.initThemeObserver();
    this.updateTheme();
  }

  init() {

    this.scene = new THREE.Scene();

    this.scene.fog = new THREE.Fog(0x0a0a0a, 3, 7);

    this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.display = 'block';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';
    canvas.style.touchAction = 'none';

    this.container.appendChild(canvas);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(this.blueColor, 1, 100);
    pointLight1.position.set(5, 5, 5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(this.greenColor, 1, 100);
    pointLight2.position.set(-5, -5, 5);
    this.scene.add(pointLight2);
  }

  createSpheres() {

  }

  createGeometry() {

    const hasLine2 = typeof THREE.LineSegments2 !== 'undefined' &&
                     typeof THREE.LineSegmentsGeometry !== 'undefined' &&
                     typeof THREE.LineMaterial !== 'undefined';

    if (hasLine2) {
      this.createThickLines();
    } else {
      this.createBasicLines();
    }
  }

  createThickLines() {

    const geometry = new THREE.IcosahedronGeometry(2.5, 1);
    const edges = new THREE.EdgesGeometry(geometry);

    const outerLineGeometry = new THREE.LineSegmentsGeometry();
    outerLineGeometry.setPositions(edges.attributes.position.array);

    this.outerMaterial = new THREE.LineMaterial({
      color: this.blueColor,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.95,
      resolution: new THREE.Vector2(this.width, this.height)
    });
    this.outerMaterial.fog = true;

    this.wireframe = new THREE.LineSegments2(outerLineGeometry, this.outerMaterial);
    this.wireframe.computeLineDistances();
    this.mainGroup.add(this.wireframe);

    const innerGeometry = new THREE.IcosahedronGeometry(1.8, 1);
    const innerEdges = new THREE.EdgesGeometry(innerGeometry);

    const innerLineGeometry = new THREE.LineSegmentsGeometry();
    innerLineGeometry.setPositions(innerEdges.attributes.position.array);

    this.innerMaterial = new THREE.LineMaterial({
      color: this.greenColor,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.7,
      resolution: new THREE.Vector2(this.width, this.height)
    });
    this.innerMaterial.fog = true;

    this.innerWireframe = new THREE.LineSegments2(innerLineGeometry, this.innerMaterial);
    this.innerWireframe.computeLineDistances();
    this.mainGroup.add(this.innerWireframe);

    this.usingThickLines = true;
  }

  createBasicLines() {

    const geometry = new THREE.IcosahedronGeometry(2.5, 1);
    const edges = new THREE.EdgesGeometry(geometry);

    this.outerMaterial = new THREE.LineBasicMaterial({
      color: this.blueColor,
      transparent: true,
      opacity: 0.9
    });

    this.wireframe = new THREE.LineSegments(edges, this.outerMaterial);
    this.mainGroup.add(this.wireframe);

    const innerGeometry = new THREE.IcosahedronGeometry(1.8, 1);
    const innerEdges = new THREE.EdgesGeometry(innerGeometry);
    this.innerMaterial = new THREE.LineBasicMaterial({
      color: this.greenColor,
      transparent: true,
      opacity: 0.6
    });
    this.innerWireframe = new THREE.LineSegments(innerEdges, this.innerMaterial);
    this.mainGroup.add(this.innerWireframe);

    this.usingThickLines = false;
  }

  createConnections() {
    const lineCount = 15;
    this.connectionLines = [];

    for (let i = 0; i < lineCount; i++) {
      const points = [];
      const startAngle = Math.random() * Math.PI * 2;
      const endAngle = startAngle + Math.PI * (0.5 + Math.random());

      for (let j = 0; j <= 20; j++) {
        const t = j / 20;
        const angle = startAngle + (endAngle - startAngle) * t;
        const radius = 2 + Math.sin(t * Math.PI) * 0.5;
        const y = (Math.random() - 0.5) * 2;

        points.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          y + Math.sin(t * Math.PI * 2) * 0.3,
          Math.sin(angle) * radius
        ));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const color = i % 2 === 0 ? this.blueColor : this.greenColor;
      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.45
      });

      const line = new THREE.Line(geometry, material);
      line.userData = {
        speed: 0.002 + Math.random() * 0.003,
        offset: Math.random() * Math.PI * 2
      };

      this.connectionLines.push(line);
      this.mainGroup.add(line);
    }
  }

  createGlowRings() {
    const ringCount = 3;
    this.rings = [];
    const ringColors = [this.blueColor, this.greenColor, this.blueColor];

    for (let i = 0; i < ringCount; i++) {
      const radius = 2.5 + i * 0.3;
      const geometry = new THREE.TorusGeometry(radius, 0.015, 8, 64);
      const material = new THREE.MeshBasicMaterial({
        color: ringColors[i],
        transparent: true,
        opacity: 0.55 - i * 0.1
      });

      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = Math.PI / 2 + (i * 0.3);
      ring.rotation.y = i * 0.4;
      ring.userData = { speed: 0.002 + i * 0.001 };

      this.rings.push(ring);
      this.mainGroup.add(ring);
    }
  }

  addEventListeners() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('selectstart', (e) => e.preventDefault());
    canvas.addEventListener('dragstart', (e) => e.preventDefault());

    const onMouseMove = (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;

      if (this.isDragging) {
        e.preventDefault();
        const deltaX = e.clientX - this.previousMouseX;
        const deltaY = e.clientY - this.previousMouseY;

        this.dragRotationY += deltaX * 0.008;
        this.dragRotationX += deltaY * 0.008;

        this.previousMouseX = e.clientX;
        this.previousMouseY = e.clientY;
      }
    };

    const onMouseDown = (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.lastInteractionTime = Date.now();
      this.previousMouseX = e.clientX;
      this.previousMouseY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };

    const onMouseUp = () => {
      this.isDragging = false;
      this.lastInteractionTime = Date.now();
      canvas.style.cursor = 'grab';
    };

    const onTouchStart = (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.lastInteractionTime = Date.now();
      this.previousMouseX = e.touches[0].clientX;
      this.previousMouseY = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      if (this.isDragging && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - this.previousMouseX;
        const deltaY = e.touches[0].clientY - this.previousMouseY;

        this.dragRotationY += deltaX * 0.008;
        this.dragRotationX += deltaY * 0.008;

        this.previousMouseX = e.touches[0].clientX;
        this.previousMouseY = e.touches[0].clientY;
      }
    };

    const onTouchEnd = () => {
      this.isDragging = false;
      this.lastInteractionTime = Date.now();
    };

    canvas.addEventListener('mousemove', onMouseMove, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown, { passive: false });
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mouseleave', onMouseUp);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    window.addEventListener('resize', () => {
      this.width = Math.max(this.container.offsetWidth, 100);
      this.height = Math.max(this.container.offsetHeight, 100);

      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(this.width, this.height);

      if (this.usingThickLines) {
        if (this.outerMaterial) {
          this.outerMaterial.resolution.set(this.width, this.height);
        }
        if (this.innerMaterial) {
          this.innerMaterial.resolution.set(this.width, this.height);
        }
      }
    });
  }

  getRandomAxis() {

    const axes = ['x', 'y', 'z'];
    const primaryAxis = axes[Math.floor(Math.random() * axes.length)];
    const secondaryAxis = axes[Math.floor(Math.random() * axes.length)];

    return {
      x: primaryAxis === 'x' ? 1 : (secondaryAxis === 'x' ? 0.3 : 0),
      y: primaryAxis === 'y' ? 1 : (secondaryAxis === 'y' ? 0.3 : 0),
      z: primaryAxis === 'z' ? 1 : (secondaryAxis === 'z' ? 0.3 : 0)
    };
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;
    const now = Date.now();

    this.targetRotationY = this.mouseX * 0.2 + this.dragRotationY;
    this.targetRotationX = this.mouseY * 0.15 + this.dragRotationX;

    this.mainGroup.rotation.y += (this.targetRotationY - this.mainGroup.rotation.y) * 0.05;
    this.mainGroup.rotation.x += (this.targetRotationX - this.mainGroup.rotation.x) * 0.05;

    if (!this.isDragging && (now - this.lastInteractionTime) > this.idleDelay) {

      if (now - this.lastAxisChangeTime > this.axisChangeInterval) {
        this.randomAxis = this.getRandomAxis();
        this.lastAxisChangeTime = now;
      }

      this.mainGroup.rotation.x += this.autoSpinSpeed * this.randomAxis.x;
      this.mainGroup.rotation.y += this.autoSpinSpeed * this.randomAxis.y;
      this.mainGroup.rotation.z += this.autoSpinSpeed * this.randomAxis.z;
    } else if (!this.isDragging) {

      this.mainGroup.rotation.y += 0.002;
    }

    if (this.wireframe) {
      this.wireframe.rotation.y = time * 0.08;
      this.wireframe.rotation.x = time * 0.04;
    }

    if (this.innerWireframe) {
      this.innerWireframe.rotation.y = -time * 0.06;
      this.innerWireframe.rotation.x = -time * 0.03;
    }

    this.renderer.render(this.scene, this.camera);
  }

  initThemeObserver() {

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          this.updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  updateTheme() {
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';

    if (this.scene.fog) {
      this.scene.fog.color.setHex(isLightTheme ? this.fogColorLight : this.fogColorDark);
    }

    const outerColor = isLightTheme ? this.blueColorLight : this.blueColor;
    if (this.outerMaterial) {
      this.outerMaterial.color.setHex(outerColor);
    }

    const innerColor = isLightTheme ? this.greenColorLight : this.greenColor;
    if (this.innerMaterial) {
      this.innerMaterial.color.setHex(innerColor);
    }

    if (isLightTheme) {
      if (this.outerMaterial) {
        this.outerMaterial.opacity = 1.0;
      }
      if (this.innerMaterial) {
        this.innerMaterial.opacity = 0.85;
      }
    } else {
      if (this.outerMaterial) {
        this.outerMaterial.opacity = 0.9;
      }
      if (this.innerMaterial) {
        this.innerMaterial.opacity = 0.6;
      }
    }
  }

  dispose() {
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

class Leadership3DBox {
  constructor(container) {
    this.container = container;
    this.width = Math.max(container.offsetWidth, 100);
    this.height = Math.max(container.offsetHeight, 100);

    this.blueColor = 0x243d93;
    this.greenColor = 0x64a443;
    this.blueColorLight = 0x1a2d6b;
    this.greenColorLight = 0x3d7a28;

    this.fogColorDark = 0x0a0a0a;
    this.fogColorLight = 0xf8f7f4;

    this.init();
    this.createBox();
    this.animate();
    this.initThemeObserver();
    this.updateTheme();
  }

  init() {
    this.scene = new THREE.Scene();

    this.scene.fog = new THREE.Fog(this.fogColorDark, 3, 7);

    this.camera = new THREE.PerspectiveCamera(65, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.display = 'block';

    this.container.appendChild(canvas);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(this.blueColor, 0.8, 100);
    pointLight1.position.set(5, 5, 5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(this.greenColor, 0.8, 100);
    pointLight2.position.set(-5, -5, 5);
    this.scene.add(pointLight2);

    window.addEventListener('resize', () => {
      this.width = Math.max(this.container.offsetWidth, 100);
      this.height = Math.max(this.container.offsetHeight, 100);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);

      if (this.outerMaterial && this.outerMaterial.resolution) {
        this.outerMaterial.resolution.set(this.width, this.height);
      }
      if (this.innerMaterial && this.innerMaterial.resolution) {
        this.innerMaterial.resolution.set(this.width, this.height);
      }
    });
  }

  createBox() {
    const hasLine2 = typeof THREE.LineSegments2 !== 'undefined' &&
                     typeof THREE.LineSegmentsGeometry !== 'undefined' &&
                     typeof THREE.LineMaterial !== 'undefined';

    const outerGeometry = new THREE.BoxGeometry(2, 2, 2);
    const outerEdges = new THREE.EdgesGeometry(outerGeometry);

    const innerGeometry = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const innerEdges = new THREE.EdgesGeometry(innerGeometry);

    if (hasLine2) {

      const outerLineGeometry = new THREE.LineSegmentsGeometry();
      outerLineGeometry.setPositions(outerEdges.attributes.position.array);

      this.outerMaterial = new THREE.LineMaterial({
        color: this.blueColor,
        linewidth: 2,
        transparent: true,
        opacity: 0.95,
        resolution: new THREE.Vector2(this.width, this.height)
      });
      this.outerMaterial.fog = true;

      this.outerBox = new THREE.LineSegments2(outerLineGeometry, this.outerMaterial);
      this.outerBox.computeLineDistances();
      this.mainGroup.add(this.outerBox);

      const innerLineGeometry = new THREE.LineSegmentsGeometry();
      innerLineGeometry.setPositions(innerEdges.attributes.position.array);

      this.innerMaterial = new THREE.LineMaterial({
        color: this.greenColor,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.8,
        resolution: new THREE.Vector2(this.width, this.height)
      });
      this.innerMaterial.fog = true;

      this.innerBox = new THREE.LineSegments2(innerLineGeometry, this.innerMaterial);
      this.innerBox.computeLineDistances();
      this.mainGroup.add(this.innerBox);

      this.usingThickLines = true;
    } else {

      this.outerMaterial = new THREE.LineBasicMaterial({
        color: this.blueColor,
        transparent: true,
        opacity: 0.9
      });

      this.outerBox = new THREE.LineSegments(outerEdges, this.outerMaterial);
      this.mainGroup.add(this.outerBox);

      this.innerMaterial = new THREE.LineBasicMaterial({
        color: this.greenColor,
        transparent: true,
        opacity: 0.7
      });

      this.innerBox = new THREE.LineSegments(innerEdges, this.innerMaterial);
      this.mainGroup.add(this.innerBox);

      this.usingThickLines = false;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;

    const rotationX = time * 0.3;

    const swap = Math.sin(time * 0.5);

    if (this.outerBox) {
      this.outerBox.rotation.x = rotationX;

      const blueScale = 1 + swap * 0.4;
      this.outerBox.scale.set(blueScale, blueScale, blueScale);
    }

    if (this.innerBox) {
      this.innerBox.rotation.x = rotationX;

      const greenScale = 1 - swap * 0.4;
      this.innerBox.scale.set(greenScale, greenScale, greenScale);
    }

    this.renderer.render(this.scene, this.camera);
  }

  initThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          this.updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  updateTheme() {
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';

    if (this.scene.fog) {
      this.scene.fog.color.setHex(isLightTheme ? this.fogColorLight : this.fogColorDark);
    }

    const outerColor = isLightTheme ? this.blueColorLight : this.blueColor;
    const innerColor = isLightTheme ? this.greenColorLight : this.greenColor;

    if (this.outerMaterial) {
      this.outerMaterial.color.setHex(outerColor);
      this.outerMaterial.opacity = isLightTheme ? 1.0 : 0.95;
    }

    if (this.innerMaterial) {
      this.innerMaterial.color.setHex(innerColor);
      this.innerMaterial.opacity = isLightTheme ? 0.9 : 0.8;
    }
  }
}

class BuilderTriangles {
  constructor(container) {
    this.container = container;
    this.width = Math.max(container.offsetWidth, 100);
    this.height = Math.max(container.offsetHeight, 100);
    this.triangles = [];
    this.triangleMaterials = [];

    this.blueColor = 0x1a3080;
    this.greenColor = 0x2d8035;
    this.blueColorLight = 0x0f2060;
    this.greenColorLight = 0x1a5020;

    this.fogColorDark = 0x0a0a0a;
    this.fogColorLight = 0xf8f7f4;

    this.init();
    this.createTriangles();
    this.animate();
    this.initThemeObserver();
    this.updateTheme();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(this.fogColorDark, 4, 10);

    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.display = 'block';

    this.container.appendChild(canvas);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(this.blueColor, 1, 100);
    pointLight1.position.set(5, 5, 5);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(this.greenColor, 1, 100);
    pointLight2.position.set(-5, -5, 5);
    this.scene.add(pointLight2);

    window.addEventListener('resize', () => {
      this.width = Math.max(this.container.offsetWidth, 100);
      this.height = Math.max(this.container.offsetHeight, 100);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);
    });
  }

  createTriangles() {

    this.createCircles();
  }

  createCircles() {
    const hasLine2 = typeof THREE.LineSegments2 !== 'undefined' &&
                     typeof THREE.LineSegmentsGeometry !== 'undefined' &&
                     typeof THREE.LineMaterial !== 'undefined';

    const segments = 64;

    const outerRadius = 2.2;
    const bluePositions = [];

    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      bluePositions.push(
        Math.cos(angle1) * outerRadius, Math.sin(angle1) * outerRadius, 0,
        Math.cos(angle2) * outerRadius, Math.sin(angle2) * outerRadius, 0
      );
    }

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      bluePositions.push(
        0, 0, 0,
        Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, 0
      );
    }

    const arcRadius = outerRadius * 1.15;
    for (let i = 0; i < 4; i++) {
      const startAngle = (i / 4) * Math.PI * 2 + 0.1;
      const endAngle = startAngle + 0.5;
      for (let j = 0; j < 8; j++) {
        const a1 = startAngle + (j / 8) * (endAngle - startAngle);
        const a2 = startAngle + ((j + 1) / 8) * (endAngle - startAngle);
        bluePositions.push(
          Math.cos(a1) * arcRadius, Math.sin(a1) * arcRadius, 0,
          Math.cos(a2) * arcRadius, Math.sin(a2) * arcRadius, 0
        );
      }
    }

    if (hasLine2) {
      const blueLineGeometry = new THREE.LineSegmentsGeometry();
      blueLineGeometry.setPositions(bluePositions);

      this.outerMaterial = new THREE.LineMaterial({
        color: this.blueColor,
        linewidth: 2,
        transparent: true,
        opacity: 0.9,
        resolution: new THREE.Vector2(this.width, this.height)
      });

      this.outerCircle = new THREE.LineSegments2(blueLineGeometry, this.outerMaterial);
      this.outerCircle.computeLineDistances();
    } else {
      const blueGeometry = new THREE.BufferGeometry();
      blueGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bluePositions), 3));

      this.outerMaterial = new THREE.LineBasicMaterial({
        color: this.blueColor,
        transparent: true,
        opacity: 0.9
      });

      this.outerCircle = new THREE.LineSegments(blueGeometry, this.outerMaterial);
    }

    this.mainGroup.add(this.outerCircle);

    const innerRadius = 1.4;
    const greenPositions = [];

    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      greenPositions.push(
        Math.cos(angle1) * innerRadius, Math.sin(angle1) * innerRadius, 0,
        Math.cos(angle2) * innerRadius, Math.sin(angle2) * innerRadius, 0
      );
    }

    const innerDecoRadius = innerRadius * 0.6;
    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      greenPositions.push(
        Math.cos(angle1) * innerDecoRadius, Math.sin(angle1) * innerDecoRadius, 0,
        Math.cos(angle2) * innerDecoRadius, Math.sin(angle2) * innerDecoRadius, 0
      );
    }

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      greenPositions.push(
        Math.cos(angle) * innerDecoRadius, Math.sin(angle) * innerDecoRadius, 0,
        Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius, 0
      );
    }

    if (hasLine2) {
      const greenLineGeometry = new THREE.LineSegmentsGeometry();
      greenLineGeometry.setPositions(greenPositions);

      this.innerMaterial = new THREE.LineMaterial({
        color: this.greenColor,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.85,
        resolution: new THREE.Vector2(this.width, this.height)
      });

      this.innerCircle = new THREE.LineSegments2(greenLineGeometry, this.innerMaterial);
      this.innerCircle.computeLineDistances();
    } else {
      const greenGeometry = new THREE.BufferGeometry();
      greenGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(greenPositions), 3));

      this.innerMaterial = new THREE.LineBasicMaterial({
        color: this.greenColor,
        transparent: true,
        opacity: 0.85
      });

      this.innerCircle = new THREE.LineSegments(greenGeometry, this.innerMaterial);
    }

    this.mainGroup.add(this.innerCircle);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;

    if (this.outerCircle) {
      this.outerCircle.rotation.z = time * 0.15;
    }

    if (this.innerCircle) {
      this.innerCircle.rotation.z = -time * 0.2;
    }

    this.renderer.render(this.scene, this.camera);
  }

  initThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          this.updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  updateTheme() {
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';

    if (this.scene.fog) {
      this.scene.fog.color.setHex(isLightTheme ? this.fogColorLight : this.fogColorDark);
    }

    const blueColor = isLightTheme ? this.blueColorLight : this.blueColor;
    const greenColor = isLightTheme ? this.greenColorLight : this.greenColor;

    if (this.outerMaterial) {
      this.outerMaterial.color.setHex(blueColor);
      this.outerMaterial.opacity = isLightTheme ? 1.0 : 0.9;
    }

    if (this.innerMaterial) {
      this.innerMaterial.color.setHex(greenColor);
      this.innerMaterial.opacity = isLightTheme ? 0.95 : 0.85;
    }
  }
}

class GlobalNetwork {
  constructor(container) {
    this.container = container;
    this.width = Math.max(container.offsetWidth, 100);
    this.height = Math.max(container.offsetHeight, 100);
    this.lines = [];
    this.lineMaterials = [];

    this.blueColor = 0x1a3080;
    this.greenColor = 0x2d8035;
    this.blueColorLight = 0x0f2060;
    this.greenColorLight = 0x1a5020;

    this.fogColorDark = 0x0a0a0a;
    this.fogColorLight = 0xf8f7f4;

    this.init();
    this.createNetwork();
    this.animate();
    this.initThemeObserver();
    this.updateTheme();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(this.fogColorDark, 4, 12);

    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.display = 'block';

    this.container.appendChild(canvas);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    window.addEventListener('resize', () => {
      this.width = Math.max(this.container.offsetWidth, 100);
      this.height = Math.max(this.container.offsetHeight, 100);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);

      this.lineMaterials.forEach(mat => {
        if (mat.resolution) {
          mat.resolution.set(this.width, this.height);
        }
      });
    });
  }

  createNetwork() {
    const hasLine2 = typeof THREE.LineSegments2 !== 'undefined' &&
                     typeof THREE.LineSegmentsGeometry !== 'undefined' &&
                     typeof THREE.LineMaterial !== 'undefined';

    const nodeCount = 20;
    const nodes = [];
    const radius = 2.2;

    for (let i = 0; i < nodeCount; i++) {
      const phi = Math.acos(-1 + (2 * i) / nodeCount);
      const theta = Math.sqrt(nodeCount * Math.PI) * phi;

      nodes.push(new THREE.Vector3(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      ));
    }

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dist = nodes[i].distanceTo(nodes[j]);
        if (dist < 2.0) {
          const isBlue = (i + j) % 2 === 0;
          const color = isBlue ? this.blueColor : this.greenColor;

          const positions = [
            nodes[i].x, nodes[i].y, nodes[i].z,
            nodes[j].x, nodes[j].y, nodes[j].z
          ];

          let line, material;

          if (hasLine2) {
            const lineGeometry = new THREE.LineSegmentsGeometry();
            lineGeometry.setPositions(positions);

            material = new THREE.LineMaterial({
              color: color,
              linewidth: 1.5,
              transparent: true,
              opacity: 0.7,
              resolution: new THREE.Vector2(this.width, this.height)
            });

            line = new THREE.LineSegments2(lineGeometry, material);
            line.computeLineDistances();
          } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

            material = new THREE.LineBasicMaterial({
              color: color,
              transparent: true,
              opacity: 0.7
            });

            line = new THREE.LineSegments(geometry, material);
          }

          line.userData = { isBlue: isBlue };
          this.lines.push(line);
          this.lineMaterials.push(material);
          this.mainGroup.add(line);
        }
      }
    }

    this.createRings();
  }

  createRings() {
    const hasLine2 = typeof THREE.LineSegments2 !== 'undefined' &&
                     typeof THREE.LineSegmentsGeometry !== 'undefined' &&
                     typeof THREE.LineMaterial !== 'undefined';

    const ringSegments = 64;

    for (let r = 0; r < 2; r++) {
      const ringRadius = 2.5 + r * 0.4;
      const isBlue = r === 0;
      const color = isBlue ? this.blueColor : this.greenColor;

      const positions = [];
      for (let i = 0; i <= ringSegments; i++) {
        const angle = (i / ringSegments) * Math.PI * 2;
        positions.push(
          Math.cos(angle) * ringRadius,
          Math.sin(angle) * ringRadius,
          0
        );
        if (i > 0 && i < ringSegments) {
          positions.push(
            Math.cos(angle) * ringRadius,
            Math.sin(angle) * ringRadius,
            0
          );
        }
      }

      let ring, material;

      if (hasLine2) {
        const lineGeometry = new THREE.LineSegmentsGeometry();
        lineGeometry.setPositions(positions);

        material = new THREE.LineMaterial({
          color: color,
          linewidth: 1.5,
          transparent: true,
          opacity: 0.6,
          resolution: new THREE.Vector2(this.width, this.height)
        });

        ring = new THREE.LineSegments2(lineGeometry, material);
        ring.computeLineDistances();
      } else {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

        material = new THREE.LineBasicMaterial({
          color: color,
          transparent: true,
          opacity: 0.6
        });

        ring = new THREE.LineSegments(geometry, material);
      }

      ring.rotation.x = Math.PI * 0.4 + r * 0.3;
      ring.rotation.y = r * 0.5;
      ring.userData = { isBlue: isBlue, rotationSpeed: 0.003 + r * 0.002 };

      this.lines.push(ring);
      this.lineMaterials.push(material);
      this.mainGroup.add(ring);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;

    this.mainGroup.rotation.y += 0.002;
    this.mainGroup.rotation.x = Math.sin(time * 0.3) * 0.1;

    this.lines.forEach(line => {
      if (line.userData.rotationSpeed) {
        line.rotation.z += line.userData.rotationSpeed;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  initThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          this.updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  updateTheme() {
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';

    if (this.scene.fog) {
      this.scene.fog.color.setHex(isLightTheme ? this.fogColorLight : this.fogColorDark);
    }

    const blueColor = isLightTheme ? this.blueColorLight : this.blueColor;
    const greenColor = isLightTheme ? this.greenColorLight : this.greenColor;

    this.lines.forEach((line, index) => {
      const material = this.lineMaterials[index];
      if (material) {
        if (line.userData.isBlue) {
          material.color.setHex(blueColor);
        } else {
          material.color.setHex(greenColor);
        }
        material.opacity = isLightTheme ? 0.8 : 0.7;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('three-container');
  if (container && typeof THREE !== 'undefined') {
    new TradingVisualization(container);
  }

  const leadershipContainer = document.getElementById('leadership-3d-container');
  if (leadershipContainer && typeof THREE !== 'undefined') {
    new Leadership3DBox(leadershipContainer);
  }

  const cultureContainer = document.getElementById('culture-3d-container');
  if (cultureContainer && typeof THREE !== 'undefined') {
    new BuilderTriangles(cultureContainer);
  }

  const contactContainer = document.getElementById('contact-3d-container');
  if (contactContainer && typeof THREE !== 'undefined') {
    new GlobalNetwork(contactContainer);
  }
});
