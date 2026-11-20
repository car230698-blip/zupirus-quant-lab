import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface ThreeHolographicMatrixProps {
  selectedLayerIdx?: number;
  onSelectLayer?: (idx: number) => void;
  className?: string;
}

export const ThreeHolographicMatrix: React.FC<ThreeHolographicMatrixProps> = ({
  selectedLayerIdx = 0,
  onSelectLayer,
  className = '',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [webGlAvailable, setWebGlAvailable] = useState(true);

  // References to keep in sync with React state
  const selectedRef = useRef(selectedLayerIdx);
  useEffect(() => {
    selectedRef.current = selectedLayerIdx;
  }, [selectedLayerIdx]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(28, 22, 38);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch {
      setWebGlAvailable(false);
      return;
    }

    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xf59e0b, 1.8);
    dirLight.position.set(15, 30, 20);
    scene.add(dirLight);

    const cyanLight = new THREE.PointLight(0x06b6d4, 2.5, 60);
    cyanLight.position.set(-15, 0, 15);
    scene.add(cyanLight);

    // 3. 4 3D Holographic Shield Plates
    const shieldGroup = new THREE.Group();
    scene.add(shieldGroup);

    const layerConfigs = [
      { name: 'Layer 1: Idempotency Key Gate', color: 0x06b6d4, yOffset: 9 },
      { name: 'Layer 2: Mandatory SL ATR(14)', color: 0xf59e0b, yOffset: 3 },
      { name: 'Layer 3: News Shield Blackout', color: 0xef4444, yOffset: -3 },
      { name: 'Layer 4: Slippage Guard', color: 0x10b981, yOffset: -9 },
    ];

    const layerMeshes: THREE.Mesh[] = [];
    const wireframeMeshes: THREE.LineSegments[] = [];

    // Create 4 distinct glass shield plates
    const plateGeo = new THREE.CylinderGeometry(11, 11, 0.4, 6); // Hexagonal shield geometry
    plateGeo.rotateX(Math.PI / 2);

    layerConfigs.forEach((cfg, idx) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.color,
        emissiveIntensity: idx === selectedRef.current ? 0.6 : 0.2,
        roughness: 0.1,
        metalness: 0.2,
        transmission: 0.85,
        transparent: true,
        opacity: idx === selectedRef.current ? 0.9 : 0.45,
        reflectivity: 0.9,
      });

      const mesh = new THREE.Mesh(plateGeo, mat);
      mesh.position.y = cfg.yOffset;
      mesh.userData = { layerIdx: idx };
      shieldGroup.add(mesh);
      layerMeshes.push(mesh);

      // Glowing hex wireframe border
      const edges = new THREE.EdgesGeometry(plateGeo);
      const lineMat = new THREE.LineBasicMaterial({
        color: cfg.color,
        linewidth: 2,
        transparent: true,
        opacity: idx === selectedRef.current ? 0.95 : 0.5,
      });
      const wire = new THREE.LineSegments(edges, lineMat);
      mesh.add(wire);
      wireframeMeshes.push(wire);
    });

    // 4. Central Energy Core Laser Beam (representing the filtered signal stream)
    const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 26, 16);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    shieldGroup.add(beamMesh);

    // Particle pulse orbiting beam
    const pulseCount = 80;
    const pulseGeo = new THREE.BufferGeometry();
    const pulsePos = new Float32Array(pulseCount * 3);
    for (let i = 0; i < pulseCount; i++) {
      const r = 2.5 + Math.random() * 8.0;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 22;
      pulsePos[i * 3] = Math.cos(theta) * r;
      pulsePos[i * 3 + 1] = y;
      pulsePos[i * 3 + 2] = Math.sin(theta) * r;
    }
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    const pulseMat = new THREE.PointsMaterial({
      color: 0xfbbf24,
      size: 0.8,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const pulsePoints = new THREE.Points(pulseGeo, pulseMat);
    shieldGroup.add(pulsePoints);

    // 5. Mouse Drag to rotate 3D Shield in 360 degrees
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      setIsRotating(true);
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      shieldGroup.rotation.y += deltaX * 0.008;
      shieldGroup.rotation.x += deltaY * 0.006;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseUp = () => {
      isDragging = false;
      setIsRotating(false);
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // 6. Raycaster to click on layers
    const raycaster = new THREE.Raycaster();
    const mouseVector = new THREE.Vector2();

    const onClick = (e: MouseEvent) => {
      const rect = dom.getBoundingClientRect();
      mouseVector.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseVector.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouseVector, camera);
      const intersects = raycaster.intersectObjects(layerMeshes);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const hitIdx = hit.userData.layerIdx;
        if (typeof hitIdx === 'number' && onSelectLayer) {
          onSelectLayer(hitIdx);
        }
      }
    };
    dom.addEventListener('click', onClick);

    // 7. Resize handling
    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // 8. Animation Loop
    let animId = 0;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Continuous subtle idle rotation when not dragged
      if (!isDragging) {
        shieldGroup.rotation.y = elapsed * 0.25;
        shieldGroup.rotation.x = Math.sin(elapsed * 0.3) * 0.12;
      }

      // Pulse stream animation
      pulsePoints.rotation.y = elapsed * 0.6;

      // Dynamic layer highlighting based on selectedLayerIdx
      layerMeshes.forEach((mesh, idx) => {
        const isSel = idx === selectedRef.current;
        const targetY = layerConfigs[idx].yOffset + (isSel ? Math.sin(elapsed * 3) * 0.35 + 0.6 : 0);
        mesh.position.y += (targetY - mesh.position.y) * 0.1;

        const targetScale = isSel ? 1.08 : 1.0;
        mesh.scale.set(targetScale, targetScale, targetScale);

        const physMat = mesh.material as THREE.MeshPhysicalMaterial;
        physMat.emissiveIntensity = isSel ? 0.75 : 0.2;
        physMat.opacity = isSel ? 0.95 : 0.45;
      });

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      if (mount.contains(dom)) {
        mount.removeChild(dom);
      }
      renderer.dispose();
      plateGeo.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
    };
  }, []);

  if (!webGlAvailable) {
    return null;
  }

  return (
    <div className={`relative h-[380px] sm:h-[460px] w-full select-none cursor-grab active:cursor-grabbing ${className}`}>
      <div ref={mountRef} className="h-full w-full" />
      <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-[11px] font-mono text-slate-400 bg-[#030610]/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 pointer-events-none">
        <span className="flex items-center gap-1.5 text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          MÔ PHỎNG 3D 4 LỚP GIÁP
        </span>
        <span className="text-slate-400">
          {isRotating ? 'ĐANG XOAY 3D' : 'Kéo chuột để xoay 360° · Bấm vào đĩa để chọn tầng'}
        </span>
      </div>
    </div>
  );
};
