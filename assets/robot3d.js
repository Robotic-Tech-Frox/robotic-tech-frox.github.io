/* RTF — live 3D robot hero.
 *
 * Loads Three.js from a pinned CDN build and renders the robot inside the
 * .stage panel. The renderer canvas is sized to exactly fill the stage so no
 * content can spill out of the panel; the panel background is set from the
 * page theme so it matches in both light and dark modes. If the CDN or WebGL
 * is unavailable, the static SVG fallback already in the DOM stays visible.
 *
 * Model sources, in priority order:
 *   1. ?onshape=<document link>  exported on the fly by the Onshape proxy
 *                                (see onshape/README.md)
 *   2. ?model=<url>              any glTF/GLB URL
 *   3. data-model on #robot3d    defaults to assets/models/bot.glb
 *
 * The default body is aggressively simplified for smooth rendering. Its small
 * number plates and labels are loaded separately at full resolution from
 * assets/models/bot-labels.glb, so the lettering stays sharp at ~10% of the
 * original triangle count. Use ?labels=<url> to override the overlay, or
 * ?onshape= for a live full-resolution export (no overlay).
 *
 * The glTF's own materials are kept untouched, so colours authored in Onshape
 * (part appearances and face colours) render as designed. If no model can be
 * loaded, the procedural placeholder robot below stays on screen.
 */
(function () {
  "use strict";

  var DEFAULT_MODEL = "assets/models/bot.glb";
  var DEFAULT_LABELS = "assets/models/bot-labels.glb";
  var FIT_SIZE = 3.1; // largest model dimension after auto-scaling, in scene units
  var DRACO_PATH = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/";
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function buildRobot(THREE) {
    var robot = new THREE.Group();

    var dark = new THREE.MeshStandardMaterial({ color: 0x17171c, metalness: 0.55, roughness: 0.45 });
    var metal = new THREE.MeshStandardMaterial({ color: 0xc0c0c8, metalness: 0.85, roughness: 0.32 });
    var orange = new THREE.MeshStandardMaterial({ color: 0xff7003, metalness: 0.25, roughness: 0.5 });
    var deepOrange = new THREE.MeshStandardMaterial({ color: 0xd95400, metalness: 0.3, roughness: 0.55 });
    var rubber = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.1, roughness: 0.9 });

    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      robot.add(m);
      return m;
    }

    // Chassis deck
    box(1.8, 0.16, 1.55, dark, 0, 0.62, 0);
    box(1.55, 0.1, 1.3, metal, 0, 0.72, 0);

    // Bumpers (orange frame)
    box(1.95, 0.3, 0.12, orange, 0, 0.62, 0.82);
    box(1.95, 0.3, 0.12, orange, 0, 0.62, -0.82);
    box(0.12, 0.3, 1.62, deepOrange, 0.96, 0.62, 0);
    box(0.12, 0.3, 1.62, deepOrange, -0.96, 0.62, 0);

    // Wheels
    var wheelGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.24, 22);
    var hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.26, 16);
    [
      [0.82, 0.27, 0.68], [-0.82, 0.27, 0.68],
      [0.82, 0.27, -0.68], [-0.82, 0.27, -0.68]
    ].forEach(function (p) {
      var wheel = new THREE.Mesh(wheelGeo, rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(p[0], p[1], p[2]);
      wheel.castShadow = true;
      robot.add(wheel);
      var hub = new THREE.Mesh(hubGeo, orange);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(p[0], p[1], p[2]);
      robot.add(hub);
    });

    // Lift rails + carriage
    box(0.1, 1.6, 0.1, metal, 0.58, 1.5, -0.15);
    box(0.1, 1.6, 0.1, metal, -0.58, 1.5, -0.15);
    box(0.1, 1.6, 0.1, metal, 0.58, 1.5, 0.1);
    box(0.1, 1.6, 0.1, metal, -0.58, 1.5, 0.1);
    box(1.35, 0.2, 0.5, dark, 0, 1.42, 0);
    box(1.15, 0.16, 0.42, orange, 0, 1.55, 0);

    // Intake rollers
    var rollerGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.15, 18);
    [-0.28, 0.28].forEach(function (y) {
      var roller = new THREE.Mesh(rollerGeo, orange);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, 0.5 + y * 0.55, 1.02);
      roller.rotation.x = 0.35;
      roller.castShadow = true;
      robot.add(roller);
    });

    // Electronics stack + camera mast
    box(0.62, 0.34, 0.44, dark, -0.35, 0.95, -0.42);
    box(0.62, 0.05, 0.44, deepOrange, -0.35, 1.14, -0.42);
    box(0.16, 0.7, 0.16, metal, 0.62, 1.25, -0.55);
    var cam = box(0.3, 0.22, 0.24, dark, 0.62, 1.66, -0.55);
    cam.rotation.y = -0.5;
    box(0.31, 0.06, 0.25, orange, 0.62, 1.79, -0.55);

    return robot;
  }

  /* ---------- model source ---------- */

  function resolveSource(stage) {
    var params = new URLSearchParams(window.location.search);
    var onshape = params.get("onshape");
    var model = params.get("model");

    if (onshape) {
      var proxy = stage.getAttribute("data-onshape-proxy") || "";
      // Local preview: server.mjs already exposes /onshape/gltf.
      if (!proxy && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
        proxy = "/onshape/gltf";
      }
      if (!proxy) {
        throw new Error(
          "Onshape links need the export proxy. Deploy onshape/worker.js and put its URL in " +
          "data-onshape-proxy on #robot3d — see onshape/README.md."
        );
      }
      return {
        kind: "onshape",
        url: proxy + (proxy.indexOf("?") === -1 ? "?" : "&") + "url=" + encodeURIComponent(onshape)
      };
    }

    if (model) {
      return {
        kind: "link",
        url: model,
        labels: params.get("labels") || ""
      };
    }

    return {
      kind: "default",
      url: stage.getAttribute("data-model") || DEFAULT_MODEL,
      labels: DEFAULT_LABELS
    };
  }

  function loadModel(GLTFLoader, DRACOLoader, MeshoptDecoder, url, onProgress) {
    return new Promise(function (resolve, reject) {
      var loader = new GLTFLoader();
      var draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_PATH);
      loader.setDRACOLoader(draco);
      // Meshopt decodes much faster than Draco, which keeps the main thread free.
      if (MeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(
        url,
        function (gltf) {
          draco.dispose();
          resolve(gltf.scene || (gltf.scenes && gltf.scenes[0]));
        },
        function (evt) {
          if (onProgress) onProgress(evt);
        },
        function () {
          draco.dispose();
          reject(new Error("Could not read the model file."));
        }
      );
    });
  }

  /* ---------- UI ---------- */

  function setNote(stage, text) {
    var el = stage.querySelector(".stage-note");
    if (!el) {
      el = document.createElement("p");
      el.className = "stage-note";
      stage.appendChild(el);
    }
    el.textContent = text;
  }

  function clearNote(stage) {
    var el = stage.querySelector(".stage-note");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function setLoaderProgress(stage, evt) {
    var loader = stage.querySelector(".stage-loader");
    var bar = loader && loader.querySelector(".stage-loader-bar i");
    if (!loader || !bar) return;
    if (evt && evt.lengthComputable && evt.total > 0) {
      loader.classList.remove("is-indeterminate");
      bar.style.width = Math.max(4, Math.min(100, (evt.loaded / evt.total) * 100)) + "%";
    }
  }

  function hideLoader(stage) {
    var loader = stage.querySelector(".stage-loader");
    if (!loader) return;
    var shown = Number(loader.getAttribute("data-shown") || 0);
    var wait = Math.max(0, 380 - (Date.now() - shown));
    window.setTimeout(function () {
      loader.classList.add("is-done");
      window.setTimeout(function () {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 340);
    }, wait);
  }

  function describeFailure(source) {
    if (source.kind === "onshape") {
      return "Couldn’t load that Onshape link — check the export proxy and that the link opens a Part Studio or Assembly.";
    }
    if (source.kind === "link") return "Couldn’t load the model from that link.";
    return "";
  }

  /* ---------- scene helpers ---------- */

  function disposeTree(root) {
    root.traverse(function (node) {
      if (!node.isMesh) return;
      if (node.geometry) node.geometry.dispose();
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(function (mat) { if (mat && mat.dispose) mat.dispose(); });
    });
  }

  function addEnvironment(THREE, ctx) {
    if (ctx.environment) return;
    var pmrem = new THREE.PMREMGenerator(ctx.renderer);
    var room = new ctx.RoomEnvironment(ctx.renderer);
    ctx.environment = pmrem.fromScene(room, 0.04).texture;
    ctx.scene.environment = ctx.environment;
    room.dispose();
    pmrem.dispose();
  }

  function frameModel(THREE, ctx, model) {
    var box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) throw new Error("The model has no visible geometry.");

    var size = box.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);
    if (!isFinite(maxDim) || maxDim <= 0) throw new Error("The model has no size.");

    model.scale.setScalar(FIT_SIZE / maxDim);
    model.updateMatrixWorld(true);

    box.setFromObject(model);
    var center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    model.updateMatrixWorld(true);

    box.setFromObject(model);
    var fit = box.getSize(new THREE.Vector3());
    ctx.stage.dataset.modelSize = [fit.x, fit.y, fit.z]
      .map(function (v) { return v.toFixed(2); })
      .join("x");

    model.traverse(function (node) {
      if (!node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(function (mat) {
        if (!mat) return;
        if (ctx.modelMaterials.indexOf(mat) === -1) ctx.modelMaterials.push(mat);
        if ("envMapIntensity" in mat) mat.envMapIntensity = 0.85;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        if (mat.transparent && mat.opacity === 1 && !mat.alphaTest) mat.transparent = false;
      });
    });

    ctx.robot.remove(ctx.placeholder);
    if (ctx.placeholder) disposeTree(ctx.placeholder);
    ctx.placeholder = null;
    ctx.robot.add(model);

    // Frame the model from a three-quarter view, independent of its size.
    var sphere = box.getBoundingSphere(new THREE.Sphere());
    var target = new THREE.Vector3(0, fit.y / 2, 0);
    var dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(ctx.camera.fov / 2))) * 1.14;
    var dir = new THREE.Vector3(0.5, 0.3, 0.82).normalize();
    ctx.camera.position.copy(target).addScaledVector(dir, dist);
    ctx.camera.near = Math.max(0.05, dist / 100);
    ctx.camera.far = Math.max(60, dist * 8);
    ctx.camera.updateProjectionMatrix();
    ctx.camera.lookAt(target);

    ctx.ground.scale.setScalar(Math.max(1, Math.max(fit.x, fit.z) / (FIT_SIZE * 1.15)));
  }

  function makeContactShadow(THREE) {
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    var g = canvas.getContext("2d");
    var grad = g.createRadialGradient(128, 128, 12, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,0.46)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.2)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function modelStats(model) {
    var tris = 0;
    var meshes = 0;
    var materials = new Set();
    model.traverse(function (node) {
      if (!node.isMesh) return;
      meshes++;
      var geo = node.geometry;
      if (geo) {
        var count = geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0);
        tris += count / 3;
      }
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(function (mat) { if (mat) materials.add(mat.uuid || mat); });
    });
    return { tris: Math.round(tris), meshes: meshes, materials: materials.size };
  }

  // Onshape GLB exports contain sRGB values in baseColorFactor, which glTF
  // defines as linear. Without this, black renders grey and orange yellow.
  function normalizeOnshapeColors(model) {
    function toLinear(v) {
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    model.traverse(function (node) {
      if (!node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(function (mat) {
        if (!mat || !mat.color) return;
        mat.color.r = toLinear(mat.color.r);
        mat.color.g = toLinear(mat.color.g);
        mat.color.b = toLinear(mat.color.b);
      });
    });
  }

  function tuneForModel(THREE, ctx) {
    var dark = document.documentElement.getAttribute("data-theme") !== "light";
    ctx.lights.hemi.color.set(0xffffff);
    ctx.lights.hemi.groundColor.set(0x0c0c10);
    ctx.lights.rim.color.set(0xffffff);
    ctx.lights.fill.color.set(0xffffff);

    if (dark) {
      // Dim, even studio light: the dark stage should not look like a spotlight.
      ctx.lights.hemi.intensity = 0.32;
      ctx.lights.key.intensity = 0.55;
      ctx.lights.rim.intensity = 0.25;
      ctx.lights.fill.intensity = 0.2;
      ctx.renderer.toneMappingExposure = 0.85;
    } else {
      ctx.lights.hemi.intensity = 0.35;
      ctx.lights.key.intensity = 1.3;
      ctx.lights.rim.intensity = 0.3;
      ctx.lights.fill.intensity = 0.1;
      ctx.renderer.toneMappingExposure = 1.0;
    }

    ctx.modelMaterials.forEach(function (mat) {
      if ("envMapIntensity" in mat) mat.envMapIntensity = dark ? 0.65 : 0.85;
    });

    // Shadow maps on a dense CAD mesh cost a second full scene pass and look noisy.
    ctx.renderer.shadowMap.enabled = false;
    ctx.stage.dataset.lighting = dark ? "dark" : "light";
  }

  /* ---------- boot ---------- */

  function boot(THREE, GLTFLoader, DRACOLoader, RoomEnvironment, MeshoptDecoder) {
    var stage = document.getElementById("robot3d");
    if (!stage) return;

    var loader = stage.querySelector(".stage-loader");
    if (loader) loader.setAttribute("data-shown", String(Date.now()));

    var width = stage.clientWidth || 600;
    var height = stage.clientHeight || 480;

    var renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // Without tone mapping the bright key light clips CAD colours to white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    stage.appendChild(renderer.domElement);

    var scene = new THREE.Scene();

    var camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 60);
    camera.position.set(2.9, 2.0, 3.6);
    camera.lookAt(0, 1.05, 0);

    var hemi = new THREE.HemisphereLight(0xbfc4d4, 0x0c0c10, 0.55);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(4, 6, 4);
    scene.add(key);

    var rim = new THREE.DirectionalLight(0xff7003, 0.9);
    rim.position.set(-4, 2.2, -3);
    scene.add(rim);

    var fill = new THREE.DirectionalLight(0x8899ff, 0.22);
    fill.position.set(-2, 1, 5);
    scene.add(fill);

    // Soft contact shadow — no shadow-map pass over the whole robot.
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 48),
      new THREE.MeshBasicMaterial({
        map: makeContactShadow(THREE),
        transparent: true,
        depthWrite: false,
        toneMapped: false
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    var robot = new THREE.Group();
    robot.position.y = 0.02;
    scene.add(robot);

    var placeholder = buildRobot(THREE);
    robot.add(placeholder);

    var ctx = {
      renderer: renderer,
      scene: scene,
      camera: camera,
      ground: ground,
      robot: robot,
      placeholder: placeholder,
      environment: null,
      RoomEnvironment: RoomEnvironment,
      stage: stage,
      modelMaterials: [],
      modelLoaded: false,
      lights: { hemi: hemi, key: key, rim: rim, fill: fill }
    };

    // Re-light the model when the page theme changes.
    var lastTheme = document.documentElement.getAttribute("data-theme");
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var theme = document.documentElement.getAttribute("data-theme");
        if (theme === lastTheme) return;
        lastTheme = theme;
        if (ctx.modelLoaded) tuneForModel(THREE, ctx);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    // Interaction: drag to rotate (with inertia), slow auto-rotate otherwise.
    var velocity = 0;
    var dragging = false;
    var lastX = 0;

    function pointerDown(e) {
      dragging = true;
      lastX = (e.touches ? e.touches[0].clientX : e.clientX);
      velocity = 0;
    }
    function pointerMove(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var dx = x - lastX;
      lastX = x;
      robot.rotation.y += dx * 0.008;
      velocity = dx * 0.008;
    }
    function pointerUp() { dragging = false; }

    var canvas = renderer.domElement;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("touchstart", pointerDown, { passive: true });
    window.addEventListener("touchmove", pointerMove, { passive: true });
    window.addEventListener("touchend", pointerUp);

    function resize() {
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(w, h);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    window.addEventListener("resize", resize);

    // Do not burn GPU time on a hero that has scrolled out of view.
    var onScreen = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
      }, { threshold: 0.01 }).observe(stage);
    }

    (function frame() {
      requestAnimationFrame(frame);
      if (!onScreen || document.hidden) return;
      if (!dragging) {
        if (Math.abs(velocity) > 0.0002) {
          robot.rotation.y += velocity;
          velocity *= 0.95;
        } else if (!REDUCED) {
          robot.rotation.y += 0.0032;
        }
      }
      renderer.render(scene, camera);
    })();

    stage.classList.add("is-live");
    stage.dataset.modelState = "placeholder";

    var source;
    try {
      source = resolveSource(stage);
    } catch (err) {
      hideLoader(stage);
      stage.dataset.modelState = "error";
      setNote(stage, err.message);
      return;
    }

    stage.dataset.modelState = "loading";
    var bodyPromise = loadModel(GLTFLoader, DRACOLoader, MeshoptDecoder, source.url, function (evt) {
      setLoaderProgress(stage, evt);
    });
    var labelsPromise = source.labels
      ? loadModel(GLTFLoader, DRACOLoader, MeshoptDecoder, source.labels).catch(function (err) {
          if (window.console && console.warn) {
            console.warn("[robot3d] labels unavailable: " + (err && err.message ? err.message : err));
          }
          return null;
        })
      : Promise.resolve(null);

    Promise.all([bodyPromise, labelsPromise]).then(function (loaded) {
      var model = loaded[0];
      var labels = loaded[1];
      if (!model) throw new Error("The model file contains no scene.");

      if (labels) {
        labels.traverse(function (node) {
          if (!node.isMesh) return;
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (mat) {
            if (!mat) return;
            mat.polygonOffset = true;
            mat.polygonOffsetFactor = -1;
            mat.polygonOffsetUnits = -1;
          });
        });
        var combined = new THREE.Group();
        combined.name = "robotModel";
        combined.add(model);
        combined.add(labels);
        model = combined;
      }

      stage.dataset.modelLabels = labels ? "1" : "0";
      if (source.kind === "onshape") normalizeOnshapeColors(model);
      var stats = modelStats(model);
      if (stats.tris > 600000 && window.console && console.warn) {
        console.warn(
          "[robot3d] Heavy model: " + stats.tris.toLocaleString() +
          " triangles. Run the optimize command in onshape/README.md."
        );
      }
      addEnvironment(THREE, ctx);
      frameModel(THREE, ctx, model);
      tuneForModel(THREE, ctx);
      ctx.modelLoaded = true;
      hideLoader(stage);
      clearNote(stage);
      stage.dataset.modelTris = String(stats.tris);
      stage.dataset.modelMaterials = String(stats.materials);
      // First paint also records the real draw-call count for diagnostics.
      renderer.render(scene, camera);
      stage.dataset.drawCalls = String(renderer.info.render.calls);
      stage.dataset.modelState = "ready";
    }).catch(function (err) {
      hideLoader(stage);
      clearNote(stage);
      // No committed export yet is the normal state, not an error.
      stage.dataset.modelState = source.kind === "default" ? "fallback" : "error";
      if (source.kind !== "default" && window.console && console.warn) {
        console.warn("[robot3d] " + (err && err.message ? err.message : err));
      }
      var note = describeFailure(source);
      if (note) setNote(stage, note);
    });
  }

  function init() {
    var stage = document.getElementById("robot3d");
    if (!stage) return;

    Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/DRACOLoader.js"),
      import("three/addons/environments/RoomEnvironment.js"),
      import("three/addons/libs/meshopt_decoder.module.js")
    ]).then(function (mods) {
      boot(mods[0], mods[1].GLTFLoader, mods[2].DRACOLoader, mods[3].RoomEnvironment, mods[4].MeshoptDecoder);
    }).catch(function () {
      /* CDN, import map or WebGL unavailable → keep the SVG fallback in place. */
      hideLoader(stage);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
