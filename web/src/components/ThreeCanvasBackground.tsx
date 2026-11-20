import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeCanvasBackgroundProps {
  theme?: 'gold' | 'cyber';
  pulseTrigger?: number; // increments on simulation / trade pulse
}

export const ThreeCanvasBackground: React.FC<ThreeCanvasBackgroundProps> = ({
  theme = 'gold',
  pulseTrigger = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef(pulseTrigger);

  useEffect(() => {
    pulseRef.current = pulseTrigger;
  }, [pulseTrigger]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.0018);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 85;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      return; // WebGL not available
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const goldLight = new THREE.PointLight(0xf59e0b, 2.5, 200);
    goldLight.position.set(40, 30, 40);
    scene.add(goldLight);

    const cyanLight = new THREE.PointLight(0x06b6d4, 2.0, 200);
    cyanLight.position.set(-40, -20, 30);
    scene.add(cyanLight);

    // 3. Central 3D Quantum Lattice (Core Holographic Geometry)
    const primaryColor = theme === 'gold' ? 0xf59e0b : 0x06b6d4;
    const secondaryColor = theme === 'gold' ? 0x06b6d4 : 0x10b981;

    const coreGroup = new THREE.Group();
    coreGroup.position.set(24, 6, 0); // Positioned slightly to the right behind cockpit
    scene.add(coreGroup);

    // Inner Icosahedron
    const icoGeo = new THREE.IcosahedronGeometry(14, 1);
    const icoMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      wireframe: true,
      emissive: primaryColor,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.75,
    });
    const icoMesh = new THREE.Mesh(icoGeo, icoMat);
    coreGroup.add(icoMesh);

    // Outer Torus Ring
    const torusGeo = new THREE.TorusGeometry(20, 0.4, 16, 100);
    const torusMat = new THREE.MeshStandardMaterial({
      color: secondaryColor,
      wireframe: true,
      emissive: secondaryColor,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.6,
    });
    const torusMesh = new THREE.Mesh(torusGeo, torusMat);
    torusMesh.rotation.x = Math.PI / 3;
    coreGroup.add(torusMesh);

    // Second Inclined Ring
    const torusGeo2 = new THREE.TorusGeometry(22, 0.25, 16, 100);
    const torusMat2 = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      wireframe: false,
      transparent: true,
      opacity: 0.35,
    });
    const torusMesh2 = new THREE.Mesh(torusGeo2, torusMat2);
    torusMesh2.rotation.y = Math.PI / 4;
    coreGroup.add(torusMesh2);

    // 4. 3D Cloud Particle Swarm (Gold & Cyan Quantum Data Dust)
    const particleCount = 600;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const c1 = new THREE.Color(primaryColor);
    const c2 = new THREE.Color(secondaryColor);
    const cWhite = new THREE.Color(0xffffff);

    for (let i = 0; i < particleCount; i++) {
      const idx = i * 3;
      positions[idx] = (Math.random() - 0.5) * 220;
      positions[idx + 1] = (Math.random() - 0.5) * 160;
      positions[idx + 2] = (Math.random() - 0.5) * 160;

      const pick = Math.random();
      const col = pick < 0.6 ? c1 : pick < 0.85 ? c2 : cWhite;
      colors[idx] = col.r;
      colors[idx + 1] = col.g;
      colors[idx + 2] = col.b;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // 5. 3D Ground Holographic Grid Plane
    const gridHelper = new THREE.GridHelper(260, 40, primaryColor, 0x1e293b);
    gridHelper.position.y = -45;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.25;
    scene.add(gridHelper);

    // 6. Interactive Mouse Movement & Parallax
    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseX = 0;
    let mouseY = 0;

    const onPointerMove = (e: MouseEvent) => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', onPointerMove, { passive: true });

    // 7. Window Resize
    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onWindowResize);

    // 8. Animation Loop
    let animId = 0;
    let clock = new THREE.Clock();
    let shockwaveScale = 1.0;
    let lastObservedPulse = pulseRef.current;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Smooth mouse lerp
      mouseX += (targetMouseX - mouseX) * 0.04;
      mouseY += (targetMouseY - mouseY) * 0.04;

      // Parallax camera rotation
      camera.position.x = mouseX * 12;
      camera.position.y = -mouseY * 8;
      camera.lookAt(0, 0, 0);

      // Rotate central 3D core
      coreGroup.rotation.y = elapsedTime * 0.35;
      coreGroup.rotation.x = Math.sin(elapsedTime * 0.2) * 0.25;
      torusMesh.rotation.z = elapsedTime * 0.4;
      torusMesh2.rotation.x = elapsedTime * 0.25;

      // Pulse reaction when user triggers simulated order
      if (pulseRef.current !== lastObservedPulse) {
        lastObservedPulse = pulseRef.current;
        shockwaveScale = 1.6;
      }
      if (shockwaveScale > 1.0) {
        shockwaveScale -= 0.02;
        coreGroup.scale.set(shockwaveScale, shockwaveScale, shockwaveScale);
      } else {
        const subtleBreath = 1.0 + Math.sin(elapsedTime * 1.5) * 0.04;
        coreGroup.scale.set(subtleBreath, subtleBreath, subtleBreath);
      }

      // Rotate particle cloud gently
      particleSystem.rotation.y = elapsedTime * 0.03;
      particleSystem.rotation.x = Math.sin(elapsedTime * 0.02) * 0.05;

      // Subtle ground wave
      gridHelper.position.z = (elapsedTime * 8) % 13;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('resize', onWindowResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      icoGeo.dispose();
      icoMat.dispose();
      torusGeo.dispose();
      torusMat.dispose();
      torusGeo2.dispose();
      torusMat2.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      gridHelper.geometry.dispose();
    };
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-85 transition-opacity duration-1000"
      aria-hidden="true"
    />
  );
};
