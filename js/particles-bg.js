
class ParticleBackground {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.mouseX = 0;
    this.mouseY = 0;

    this.blueColor = 0x243d93;
    this.greenColor = 0x64a443;

    this.init();
    this.createParticles();

    this.animate();
    this.addEventListeners();
  }

  init() {

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.container.appendChild(this.renderer.domElement);

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);
  }

  createParticles() {
    const particleCount = 120;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const velocities = [];

    const blueColorObj = new THREE.Color(this.blueColor);
    const greenColorObj = new THREE.Color(this.greenColor);

    for (let i = 0; i < particleCount; i++) {

      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6;

      const color = i % 2 === 0 ? blueColorObj : greenColorObj;
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      velocities.push({
        x: (Math.random() - 0.5) * 0.008,
        y: (Math.random() - 0.5) * 0.008,
        z: (Math.random() - 0.5) * 0.005
      });
    }

    this.particleVelocities = velocities;
    this.particleCount = particleCount;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.04,
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.mainGroup.add(this.particles);
  }

  createConnections() {
    const lineCount = 20;
    this.connectionLines = [];

    for (let i = 0; i < lineCount; i++) {
      const points = [];
      const startX = (Math.random() - 0.5) * 10;
      const startY = (Math.random() - 0.5) * 6;
      const startZ = (Math.random() - 0.5) * 4;

      for (let j = 0; j <= 15; j++) {
        const t = j / 15;
        points.push(new THREE.Vector3(
          startX + Math.sin(t * Math.PI * 2) * 1.5,
          startY + Math.cos(t * Math.PI) * 0.8,
          startZ + t * 2 - 1
        ));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const color = i % 2 === 0 ? this.blueColor : this.greenColor;
      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.08
      });

      const line = new THREE.Line(geometry, material);
      line.userData = {
        speed: 0.001 + Math.random() * 0.002,
        offset: Math.random() * Math.PI * 2
      };

      this.connectionLines.push(line);
      this.mainGroup.add(line);
    }
  }

  addEventListeners() {
    window.addEventListener('mousemove', (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    });

    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;

      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(this.width, this.height);
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (window.nksA11yAnimPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const time = Date.now() * 0.001;

    this.mainGroup.rotation.y += (this.mouseX * 0.05 - this.mainGroup.rotation.y) * 0.02;
    this.mainGroup.rotation.x += (this.mouseY * 0.03 - this.mainGroup.rotation.x) * 0.02;

    this.mainGroup.rotation.y += 0.0005;

    if (this.particles) {
      const positions = this.particles.geometry.attributes.position.array;
      for (let i = 0; i < this.particleCount; i++) {
        positions[i * 3] += this.particleVelocities[i].x;
        positions[i * 3 + 1] += this.particleVelocities[i].y;
        positions[i * 3 + 2] += this.particleVelocities[i].z;

        if (positions[i * 3] > 6) positions[i * 3] = -6;
        if (positions[i * 3] < -6) positions[i * 3] = 6;
        if (positions[i * 3 + 1] > 4) positions[i * 3 + 1] = -4;
        if (positions[i * 3 + 1] < -4) positions[i * 3 + 1] = 4;
        if (positions[i * 3 + 2] > 3) positions[i * 3 + 2] = -3;
        if (positions[i * 3 + 2] < -3) positions[i * 3 + 2] = 3;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('particles-bg');
  if (container && typeof THREE !== 'undefined') {
    new ParticleBackground(container);
  }
});
