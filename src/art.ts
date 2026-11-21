import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// A pocket-sized physical board, rendered once per resize. The play surface
// itself uses native buttons, so drawing a line never depends on WebGL.
export function mountTable(host: HTMLElement) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 80);
  camera.position.set(4.2, 8.6, 7.4);
  camera.lookAt(0, 0, 0);
  const model = new THREE.Group();
  scene.add(model);
  model.rotation.y = 0.18;
  const geo = new Map<string, THREE.BufferGeometry>(),
    mats = new Map<string, THREE.MeshStandardMaterial>();
  function piece(
    shape: string,
    build: () => THREE.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    if (!geo.has(shape)) geo.set(shape, build());
    if (!mats.has(color))
      mats.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.5,
          metalness: 0.015,
        }),
      );
    const mesh = new THREE.Mesh(geo.get(shape), mats.get(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
    return mesh;
  }
  function block(
    w: number,
    h: number,
    d: number,
    r: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    return piece(
      [w, h, d, r].join("/"),
      () => new RoundedBoxGeometry(w, h, d, 3, r),
      color,
      x,
      y,
      z,
    );
  }
  block(4.78, 0.3, 4.78, 0.14, "#534295", 0, -0.16, 0);
  block(4.76, 0.25, 4.76, 0.14, "#b1a5ee", 0, 0.015, 0);
  block(4.61, 0.18, 4.61, 0.09, "#fffcf1", 0, 0.16, 0);
  const indigo = "#6652db",
    coral = "#fb754f",
    groove = "#c9c1d9";
  const filled = [
    [0, 1, indigo],
    [1, 1, indigo],
    [2, 2, coral],
    [2, 3, coral],
    [3, 2, coral],
  ] as const;
  const rails = new Map<string, string>();
  for (const [x, z, c] of filled) {
    block(0.91, 0.08, 0.91, 0.055, c, x - 1.5, 0.27, z - 1.5);
    rails.set("h" + x + z, c);
    rails.set("h" + x + (z + 1), c);
    rails.set("v" + x + z, c);
    rails.set("v" + (x + 1) + z, c);
    if (c === indigo) {
      const stamp = piece(
        "ring",
        () => new THREE.TorusGeometry(0.156, 0.034, 10, 36),
        "#e9dcff",
        x - 1.5,
        0.316,
        z - 1.5,
      );
      stamp.rotation.x = -Math.PI / 2;
    } else {
      for (const angle of [-0.78, 0.78])
        block(
          0.35,
          0.037,
          0.069,
          0.025,
          "#ffe4bf",
          x - 1.5,
          0.316,
          z - 1.5,
        ).rotation.y = angle;
    }
  }
  rails.set("h00", coral);
  rails.set("v30", indigo);
  rails.set("h13", indigo);
  rails.set("v02", coral);
  for (let z = 0; z <= 4; z++)
    for (let x = 0; x <= 4; x++) {
      for (const dir of ["h", "v"]) {
        if ((dir === "h" && x === 4) || (dir === "v" && z === 4)) continue;
        const c = rails.get(dir + x + z);
        block(
          dir === "h" ? 0.92 : c ? 0.12 : 0.055,
          c ? 0.12 : 0.025,
          dir === "v" ? 0.92 : c ? 0.12 : 0.055,
          0.025,
          c ?? groove,
          x - 2 + (dir === "h" ? 0.5 : 0),
          c ? 0.31 : 0.257,
          z - 2 + (dir === "v" ? 0.5 : 0),
        );
      }
      piece(
        "stud",
        () => new THREE.CylinderGeometry(0.113, 0.125, 0.115, 24),
        "#332952",
        x - 2,
        0.345,
        z - 2,
      );
      piece(
        "cap",
        () => new THREE.CylinderGeometry(0.096, 0.108, 0.03, 24),
        "#554971",
        x - 2,
        0.415,
        z - 2,
      );
    }
  scene.add(new THREE.HemisphereLight(0xfff9ed, 0xc4b2ef, 2.1));
  const sun = new THREE.DirectionalLight(0xfffbef, 2.55);
  sun.position.set(-3, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  sun.shadow.normalBias = 0.018;
  scene.add(sun);
  const shadowGeo = new THREE.PlaneGeometry(25, 25),
    shadowMat = new THREE.ShadowMaterial({ opacity: 0.16 });
  const floor = new THREE.Mesh(shadowGeo, shadowMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.34;
  floor.receiveShadow = true;
  scene.add(floor);
  host.append(renderer.domElement);
  function draw() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    const ratio = w / h,
      half = Math.max(2.68, 3.43 / ratio);
    camera.left = -half * ratio;
    camera.right = half * ratio;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.render(scene, camera);
    host.classList.add("rendered");
  }
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  draw();
  return () => {
    ro.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
    sun.shadow.dispose();
    geo.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    shadowGeo.dispose();
    shadowMat.dispose();
  };
}
