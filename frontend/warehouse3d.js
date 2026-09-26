/**
 * StockSense 3D Digital Twin - Architectural Light Studio Edition
 * Built with Babylon.js (https://www.babylonjs.com/)
 * Clearly visualizes the complete Odoo IMS inventory process flow
 */

class Warehouse3D {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.glowLayer = null;
    
    this.racks = new Map(); // locName -> { rootMesh, beaconMesh, beaconMat, position }
    this.zones = new Map(); // zoneKey -> { name, mesh, position, cameraTarget }
    this.isAutoRotating = true;
    this.currentStep = 0;
    this.activeTransferCargo = null;

    this.init();
  }

  init() {
    try {
      // 1. Initialize Babylon Engine
      this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
      this.scene = new BABYLON.Scene(this.engine);
      
      // Crisp, clean architectural studio background (light airy slate-gray)
      this.scene.clearColor = new BABYLON.Color4(0.94, 0.95, 0.97, 1.0);

      // 2. Camera Setup (Isometric & Smooth Orbit)
      this.camera = new BABYLON.ArcRotateCamera(
        "StudioCamera",
        BABYLON.Tools.ToRadians(45),
        BABYLON.Tools.ToRadians(55),
        55,
        new BABYLON.Vector3(0, 3, 0),
        this.scene
      );
      this.camera.attachControl(this.canvas, true);
      this.camera.lowerRadiusLimit = 16;
      this.camera.upperRadiusLimit = 90;
      this.camera.lowerBetaLimit = 0.2;
      this.camera.upperBetaLimit = Math.PI / 2.05;
      this.camera.inertia = 0.85;

      // 3. Bright Architectural Studio Lighting
      const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), this.scene);
      hemiLight.intensity = 0.85;
      hemiLight.diffuse = new BABYLON.Color3(1.0, 1.0, 1.0);
      hemiLight.groundColor = new BABYLON.Color3(0.85, 0.88, 0.92);

      const sunLight = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(-1, -2, -1.2), this.scene);
      sunLight.position = new BABYLON.Vector3(30, 50, 30);
      sunLight.intensity = 0.95;
      sunLight.diffuse = new BABYLON.Color3(1.0, 0.98, 0.95);

      const fillLight = new BABYLON.PointLight("fillLight", new BABYLON.Vector3(0, 20, 0), this.scene);
      fillLight.intensity = 0.5;
      fillLight.diffuse = new BABYLON.Color3(0.9, 0.95, 1.0);
      fillLight.range = 60;

      // 4. Glow Layer for status indicators & process paths
      this.glowLayer = new BABYLON.GlowLayer("glowLayer", this.scene);
      this.glowLayer.intensity = 0.45;

      // 5. Build Complete Process Flow Warehouse
      this.buildStudioFloorAndFlowLanes();
      this.buildProcessZones();
      this.buildStorageRacks();
      this.buildZoneSignposts();

      // 6. Interaction Observables
      this.setupInteractions();

      // 7. Render Loop
      this.engine.runRenderLoop(() => {
        if (this.isAutoRotating && !this.scene.alreadyPanning) {
          this.camera.alpha += 0.0012;
        }
        this.scene.render();
      });

      window.addEventListener("resize", () => {
        this.engine.resize();
      });
    } catch (e) {
      console.warn("Babylon 3D Engine Initialization notice:", e);
    }
  }

  buildStudioFloorAndFlowLanes() {
    // 1. Polished Light Concrete Epoxy Floor
    const floor = BABYLON.MeshBuilder.CreateGround("studioFloor", { width: 75, height: 75 }, this.scene);
    const floorMat = new BABYLON.StandardMaterial("floorMat", this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.92, 0.94, 0.96);
    floorMat.specularColor = new BABYLON.Color3(0.2, 0.22, 0.25);
    floor.material = floorMat;

    // Helper for creating colored floor lanes with clear flow markings
    const createFloorStrip = (name, x, z, w, d, color, emissiveScale = 0.1) => {
      const strip = BABYLON.MeshBuilder.CreateGround(name, { width: w, height: d }, this.scene);
      strip.position = new BABYLON.Vector3(x, 0.02, z);
      const mat = new BABYLON.StandardMaterial(`${name}Mat`, this.scene);
      mat.diffuseColor = color;
      mat.emissiveColor = color.scale(emissiveScale);
      strip.material = mat;
      return strip;
    };

    // Flow Lane Colors
    const greenReceiving = new BABYLON.Color3(0.06, 0.72, 0.45); // Emerald Green: Receipts
    const amberTransfer = new BABYLON.Color3(0.95, 0.62, 0.07);  // Amber: Internal Transfer
    const blueShipping = new BABYLON.Color3(0.12, 0.55, 0.95);   // Cyan/Blue: Deliveries
    const purpleAudit = new BABYLON.Color3(0.55, 0.28, 0.85);    // Purple: Adjustments

    // Main East-West Center Transit Highway
    createFloorStrip("mainCenterAisle", 0, 0, 60, 4.2, new BABYLON.Color3(0.85, 0.88, 0.92));

    // LANE 1: Inbound Receiving Lane (Green) from West Dock to Main Store
    createFloorStrip("laneInbound", -16, 0, 16, 2.2, greenReceiving, 0.25);
    // Green arrow guides
    createFloorStrip("laneInboundBranch", -10, -5, 2.2, 10, greenReceiving, 0.25);

    // LANE 2: Internal Transfer Lane (Amber) between Main Store & Production Rack
    createFloorStrip("laneTransfer", 0, -10, 16, 2.0, amberTransfer, 0.25);

    // LANE 3: Outbound Shipping Lane (Blue) from Production Rack to East Dispatch Dock
    createFloorStrip("laneOutboundBranch", 10, -5, 2.2, 10, blueShipping, 0.25);
    createFloorStrip("laneOutbound", 16, 0, 16, 2.2, blueShipping, 0.25);

    // LANE 4: Quality & Audit Area Boundary (Purple)
    createFloorStrip("auditBoundary", 0, 18, 18, 12, new BABYLON.Color3(0.88, 0.85, 0.95));
    createFloorStrip("auditStripL", -9, 18, 0.3, 12, purpleAudit, 0.3);
    createFloorStrip("auditStripR", 9, 18, 0.3, 12, purpleAudit, 0.3);
  }

  buildProcessZones() {
    // Helper to create warehouse zone platforms
    const createDockPlatform = (name, x, z, w, d, col) => {
      const dock = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: 0.4, depth: d }, this.scene);
      dock.position = new BABYLON.Vector3(x, 0.2, z);
      const mat = new BABYLON.StandardMaterial(`${name}Mat`, this.scene);
      mat.diffuseColor = col;
      mat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
      dock.material = mat;
      return dock;
    };

    // ZONE 1: Inbound Receiving Dock (West: x = -26, z = 0)
    const inDock = createDockPlatform("inboundDockPlatform", -26, 0, 8, 16, new BABYLON.Color3(0.9, 0.95, 0.92));
    this.createDeliveryTruck(-30, 0, true); // Delivery Truck parked at Receiving
    this.createPalletStack(-25, 0.4, -3, 3, "raw_steel"); // Incoming steel raw materials

    // ZONE 3: Production Workstation (Center-East: x = 10, z = -10)
    this.createAssemblyWorkstation(10, 0.2, -6);

    // ZONE 4: Outbound Shipping Dock (East: x = 26, z = 0)
    const outDock = createDockPlatform("outboundDockPlatform", 26, 0, 8, 16, new BABYLON.Color3(0.9, 0.93, 0.98));
    this.createDeliveryTruck(30, 0, false); // Customer delivery vehicle parked
    this.createPalletStack(25, 0.4, 3, 2, "finished_boxes"); // Staged customer shipments

    // ZONE 5: Physical Count & Audit Table (North: x = 0, z = 18)
    this.createAuditStation(0, 0, 18);
  }

  createDeliveryTruck(x, z, isInbound) {
    const truckRoot = new BABYLON.TransformNode(`truck_${isInbound ? 'in' : 'out'}`, this.scene);
    truckRoot.position = new BABYLON.Vector3(x, 0, z);

    const bodyMat = new BABYLON.StandardMaterial("truckMat", this.scene);
    bodyMat.diffuseColor = isInbound ? new BABYLON.Color3(0.1, 0.6, 0.4) : new BABYLON.Color3(0.2, 0.4, 0.85);

    const cabMat = new BABYLON.StandardMaterial("cabMat", this.scene);
    cabMat.diffuseColor = new BABYLON.Color3(0.25, 0.28, 0.35);

    // Cargo Container
    const container = BABYLON.MeshBuilder.CreateBox("truckContainer", { width: 5.5, height: 3.2, depth: 3.2 }, this.scene);
    container.position = new BABYLON.Vector3(0, 2.0, 0);
    container.material = bodyMat;
    container.parent = truckRoot;

    // Driver Cab
    const cab = BABYLON.MeshBuilder.CreateBox("truckCab", { width: 2.2, height: 2.5, depth: 3.0 }, this.scene);
    cab.position = new BABYLON.Vector3(isInbound ? -3.8 : 3.8, 1.6, 0);
    cab.material = cabMat;
    cab.parent = truckRoot;
  }

  createPalletStack(x, y, z, count, type) {
    const stackRoot = new BABYLON.TransformNode(`stack_${x}_${z}`, this.scene);
    stackRoot.position = new BABYLON.Vector3(x, y, z);

    const woodMat = new BABYLON.StandardMaterial("woodMat", this.scene);
    woodMat.diffuseColor = new BABYLON.Color3(0.72, 0.58, 0.42);

    const cargoMat = new BABYLON.StandardMaterial("cargoItemMat", this.scene);
    if (type === "raw_steel") {
      cargoMat.diffuseColor = new BABYLON.Color3(0.4, 0.45, 0.55); // Metallic steel rods
      cargoMat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.9);
    } else {
      cargoMat.diffuseColor = new BABYLON.Color3(0.82, 0.72, 0.52); // Cardboard boxes
    }

    for (let i = 0; i < count; i++) {
      const pallet = BABYLON.MeshBuilder.CreateBox(`p_${i}`, { width: 1.8, height: 0.18, depth: 1.5 }, this.scene);
      pallet.position = new BABYLON.Vector3(0, i * 1.1 + 0.1, 0);
      pallet.material = woodMat;
      pallet.parent = stackRoot;

      const cargo = BABYLON.MeshBuilder.CreateBox(`c_${i}`, { width: 1.5, height: 0.9, depth: 1.3 }, this.scene);
      cargo.position = new BABYLON.Vector3(0, i * 1.1 + 0.65, 0);
      cargo.material = cargoMat;
      cargo.parent = stackRoot;
    }
  }

  createAssemblyWorkstation(x, y, z) {
    const tableRoot = new BABYLON.TransformNode("assemblyTable", this.scene);
    tableRoot.position = new BABYLON.Vector3(x, y, z);

    const tableMat = new BABYLON.StandardMaterial("tableMat", this.scene);
    tableMat.diffuseColor = new BABYLON.Color3(0.3, 0.35, 0.42);

    // Workbench
    const bench = BABYLON.MeshBuilder.CreateBox("bench", { width: 4.5, height: 0.9, depth: 2.2 }, this.scene);
    bench.position = new BABYLON.Vector3(0, 0.45, 0);
    bench.material = tableMat;
    bench.parent = tableRoot;

    // Component pieces being assembled (steel frame)
    const frameMat = new BABYLON.StandardMaterial("frameMat", this.scene);
    frameMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.9);

    const frameItem = BABYLON.MeshBuilder.CreateBox("assemblyItem", { width: 1.8, height: 0.8, depth: 1.2 }, this.scene);
    frameItem.position = new BABYLON.Vector3(0, 1.3, 0);
    frameItem.material = frameMat;
    frameItem.parent = tableRoot;
  }

  createAuditStation(x, y, z) {
    const auditRoot = new BABYLON.TransformNode("auditStation", this.scene);
    auditRoot.position = new BABYLON.Vector3(x, y, z);

    // Inspection Table
    const tableMat = new BABYLON.StandardMaterial("inspTableMat", this.scene);
    tableMat.diffuseColor = new BABYLON.Color3(0.8, 0.82, 0.85);

    const desk = BABYLON.MeshBuilder.CreateBox("inspDesk", { width: 5.0, height: 0.9, depth: 2.5 }, this.scene);
    desk.position = new BABYLON.Vector3(0, 0.45, 0);
    desk.material = tableMat;
    desk.parent = auditRoot;

    // Quarantine Crate for damaged items (Red accent)
    const redMat = new BABYLON.StandardMaterial("damageMat", this.scene);
    redMat.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.25);
    redMat.emissiveColor = new BABYLON.Color3(0.3, 0.05, 0.05);

    const damageBox = BABYLON.MeshBuilder.CreateBox("damageCrate", { width: 1.4, height: 0.8, depth: 1.2 }, this.scene);
    damageBox.position = new BABYLON.Vector3(1.4, 1.3, 0);
    damageBox.material = redMat;
    damageBox.parent = auditRoot;
  }

  buildStorageRacks() {
    const rackConfigs = [
      { name: "Main Store", x: -10, z: -10, bays: 3, tiers: 3, color: new BABYLON.Color3(0.15, 0.45, 0.85) },
      { name: "Production Rack", x: 10, z: -10, bays: 3, tiers: 3, color: new BABYLON.Color3(0.92, 0.55, 0.1) },
      { name: "Rack A", x: -10, z: 10, bays: 3, tiers: 3, color: new BABYLON.Color3(0.1, 0.65, 0.4) },
      { name: "Rack B", x: 10, z: 10, bays: 3, tiers: 3, color: new BABYLON.Color3(0.55, 0.3, 0.8) },
      { name: "Storage Yard", x: 0, z: 22, bays: 2, tiers: 2, color: new BABYLON.Color3(0.45, 0.48, 0.55) }
    ];

    rackConfigs.forEach(cfg => {
      this.createIndustrialRack(cfg);
    });
  }

  createIndustrialRack(cfg) {
    const rackRoot = new BABYLON.TransformNode(`rack_${cfg.name}`, this.scene);
    rackRoot.position = new BABYLON.Vector3(cfg.x, 0, cfg.z);

    const bayWidth = 3.6;
    const tierHeight = 2.4;
    const rackDepth = 2.0;

    // Upright blue/dark steel columns
    const uprightMat = new BABYLON.StandardMaterial(`upright_${cfg.name}`, this.scene);
    uprightMat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.3);

    // Cross beams (Odoo/Industrial safety orange or theme color)
    const beamMat = new BABYLON.StandardMaterial(`beam_${cfg.name}`, this.scene);
    beamMat.diffuseColor = cfg.color;

    // Pallets & Cargo boxes
    const woodMat = new BABYLON.StandardMaterial(`wood_${cfg.name}`, this.scene);
    woodMat.diffuseColor = new BABYLON.Color3(0.75, 0.6, 0.45);

    const boxMat = new BABYLON.StandardMaterial(`box_${cfg.name}`, this.scene);
    boxMat.diffuseColor = new BABYLON.Color3(0.85, 0.75, 0.6);

    const totalWidth = cfg.bays * bayWidth;

    // Columns
    for (let b = 0; b <= cfg.bays; b++) {
      const colX = (b * bayWidth) - (totalWidth / 2);
      
      const colF = BABYLON.MeshBuilder.CreateBox(`colF_${cfg.name}_${b}`, { width: 0.16, height: cfg.tiers * tierHeight + 0.5, depth: 0.16 }, this.scene);
      colF.position = new BABYLON.Vector3(colX, (cfg.tiers * tierHeight + 0.5) / 2, -rackDepth / 2);
      colF.material = uprightMat;
      colF.parent = rackRoot;

      const colB = BABYLON.MeshBuilder.CreateBox(`colB_${cfg.name}_${b}`, { width: 0.16, height: cfg.tiers * tierHeight + 0.5, depth: 0.16 }, this.scene);
      colB.position = new BABYLON.Vector3(colX, (cfg.tiers * tierHeight + 0.5) / 2, rackDepth / 2);
      colB.material = uprightMat;
      colB.parent = rackRoot;
    }

    // Tiers & Pallets
    for (let t = 1; t <= cfg.tiers; t++) {
      const beamY = t * tierHeight;

      const beamF = BABYLON.MeshBuilder.CreateBox(`beamF_${cfg.name}_${t}`, { width: totalWidth, height: 0.18, depth: 0.12 }, this.scene);
      beamF.position = new BABYLON.Vector3(0, beamY, -rackDepth / 2);
      beamF.material = beamMat;
      beamF.parent = rackRoot;

      const beamB = BABYLON.MeshBuilder.CreateBox(`beamB_${cfg.name}_${t}`, { width: totalWidth, height: 0.18, depth: 0.12 }, this.scene);
      beamB.position = new BABYLON.Vector3(0, beamY, rackDepth / 2);
      beamB.material = beamMat;
      beamB.parent = rackRoot;

      for (let b = 0; b < cfg.bays; b++) {
        const itemX = (b * bayWidth) - (totalWidth / 2) + (bayWidth / 2);

        const pallet = BABYLON.MeshBuilder.CreateBox(`pallet_${cfg.name}_${t}_${b}`, { width: 2.2, height: 0.2, depth: 1.6 }, this.scene);
        pallet.position = new BABYLON.Vector3(itemX, beamY + 0.1, 0);
        pallet.material = woodMat;
        pallet.parent = rackRoot;

        const box1 = BABYLON.MeshBuilder.CreateBox(`box_${cfg.name}_${t}_${b}_1`, { width: 0.95, height: 1.1, depth: 1.2 }, this.scene);
        box1.position = new BABYLON.Vector3(itemX - 0.5, beamY + 0.75, 0);
        box1.material = boxMat;
        box1.parent = rackRoot;

        const box2 = BABYLON.MeshBuilder.CreateBox(`box_${cfg.name}_${t}_${b}_2`, { width: 0.95, height: 1.1, depth: 1.2 }, this.scene);
        box2.position = new BABYLON.Vector3(itemX + 0.5, beamY + 0.75, 0);
        box2.material = boxMat;
        box2.parent = rackRoot;
      }
    }

    // Top Status Beacon (LED Indicator: Emerald Green / Amber / Red)
    const beaconY = (cfg.tiers * tierHeight) + 0.9;
    const beacon = BABYLON.MeshBuilder.CreateSphere(`beacon_${cfg.name}`, { diameter: 0.7 }, this.scene);
    beacon.position = new BABYLON.Vector3(0, beaconY, 0);
    const beaconMat = new BABYLON.StandardMaterial(`beaconMat_${cfg.name}`, this.scene);
    beaconMat.diffuseColor = new BABYLON.Color3(0.08, 0.8, 0.4);
    beaconMat.emissiveColor = new BABYLON.Color3(0.08, 0.8, 0.4);
    beacon.material = beaconMat;
    beacon.parent = rackRoot;

    // Pickable bounding box
    const clickBox = BABYLON.MeshBuilder.CreateBox(`target_${cfg.name}`, {
      width: totalWidth + 1.2,
      height: cfg.tiers * tierHeight + 1.8,
      depth: rackDepth + 1.4
    }, this.scene);
    clickBox.position = new BABYLON.Vector3(0, (cfg.tiers * tierHeight + 1.8) / 2, 0);
    clickBox.visibility = 0.001;
    clickBox.isPickable = true;
    clickBox.parent = rackRoot;
    clickBox.metadata = { rackName: cfg.name };

    this.racks.set(cfg.name, {
      rootMesh: rackRoot,
      beacon: beacon,
      beaconMat: beaconMat,
      position: new BABYLON.Vector3(cfg.x, 0, cfg.z),
      stockStatus: "normal"
    });
  }

  buildZoneSignposts() {
    // Helper to create clean 3D Billboard Signposts for each Process Zone
    const createSignpost = (text, subtitle, x, y, z, colorHex) => {
      const plane = BABYLON.MeshBuilder.CreatePlane(`sign_${text}`, { width: 7.2, height: 2.2 }, this.scene);
      plane.position = new BABYLON.Vector3(x, y, z);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

      const dt = new BABYLON.DynamicTexture(`dt_${text}`, { width: 512, height: 160 }, this.scene, true);
      const ctx = dt.getContext();

      // Rounded background
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillRect(0, 0, 512, 160);

      // Color accent left border
      ctx.fillStyle = colorHex;
      ctx.fillRect(0, 0, 16, 160);

      // Title
      ctx.font = "bold 36px Inter, sans-serif";
      ctx.fillStyle = "#0F172A";
      ctx.fillText(text, 36, 68);

      // Subtitle
      ctx.font = "500 24px Inter, sans-serif";
      ctx.fillStyle = "#64748B";
      ctx.fillText(subtitle, 36, 115);

      dt.update();

      const mat = new BABYLON.StandardMaterial(`mat_${text}`, this.scene);
      mat.diffuseTexture = dt;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
      mat.backFaceCulling = true;
      plane.material = mat;
    };

    createSignpost("1. INBOUND RECEIVING", "Vendor Goods Arrival (+Stock)", -26, 6.5, 0, "#10B981");
    createSignpost("2. MAIN STORE", "High-Bay Stock Inventory", -10, 9.5, -10, "#3B82F6");
    createSignpost("3. PRODUCTION AREA", "Assembly Rack (Internal Transfers)", 10, 9.5, -10, "#F59E0B");
    createSignpost("4. OUTBOUND SHIPPING", "Customer Delivery Orders (-Stock)", 26, 6.5, 0, "#0284C7");
    createSignpost("5. AUDIT & INSPECTION", "Physical Count Discrepancies (Δ)", 0, 6.5, 18, "#8B5CF6");
  }

  setupInteractions() {
    this.scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERMOVE:
          if (pointerInfo.pickInfo && pointerInfo.pickInfo.hit && pointerInfo.pickInfo.pickedMesh) {
            const mesh = pointerInfo.pickInfo.pickedMesh;
            if (mesh.metadata && mesh.metadata.rackName) {
              this.canvas.style.cursor = "pointer";
            } else {
              this.canvas.style.cursor = "default";
            }
          }
          break;

        case BABYLON.PointerEventTypes.POINTERDOWN:
          this.isAutoRotating = false;
          if (pointerInfo.pickInfo && pointerInfo.pickInfo.hit && pointerInfo.pickInfo.pickedMesh) {
            const mesh = pointerInfo.pickInfo.pickedMesh;
            if (mesh.metadata && mesh.metadata.rackName) {
              this.focusOnRack(mesh.metadata.rackName);
            }
          }
          break;
      }
    });
  }

  focusOnRack(rackName) {
    const rack = this.racks.get(rackName);
    if (!rack) return;

    this.animateCameraTo(
      new BABYLON.Vector3(rack.position.x, 4.0, rack.position.z),
      22,
      BABYLON.Tools.ToRadians(45),
      BABYLON.Tools.ToRadians(55)
    );

    if (window.on3DRackSelected) {
      window.on3DRackSelected(rackName);
    }
  }

  animateCameraTo(target, radius, alpha, beta) {
    BABYLON.Animation.CreateAndStartAnimation("camTarget", this.camera, "target", 60, 30, this.camera.target, target, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, new BABYLON.CubicEase());
    BABYLON.Animation.CreateAndStartAnimation("camRadius", this.camera, "radius", 60, 30, this.camera.radius, radius, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, new BABYLON.CubicEase());
    if (alpha !== undefined) {
      BABYLON.Animation.CreateAndStartAnimation("camAlpha", this.camera, "alpha", 60, 30, this.camera.alpha, alpha, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, new BABYLON.CubicEase());
    }
    if (beta !== undefined) {
      BABYLON.Animation.CreateAndStartAnimation("camBeta", this.camera, "beta", 60, 30, this.camera.beta, beta, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, new BABYLON.CubicEase());
    }
  }

  // Set Camera Preset Views
  setCameraPreset(preset) {
    if (preset === "overview") {
      this.animateCameraTo(new BABYLON.Vector3(0, 3, 0), 55, BABYLON.Tools.ToRadians(45), BABYLON.Tools.ToRadians(55));
    } else if (preset === "main_store") {
      this.animateCameraTo(new BABYLON.Vector3(-10, 4, -10), 24, BABYLON.Tools.ToRadians(30), BABYLON.Tools.ToRadians(55));
    } else if (preset === "production") {
      this.animateCameraTo(new BABYLON.Vector3(10, 4, -10), 24, BABYLON.Tools.ToRadians(120), BABYLON.Tools.ToRadians(55));
    } else if (preset === "docks") {
      this.animateCameraTo(new BABYLON.Vector3(0, 2, 0), 45, BABYLON.Tools.ToRadians(90), BABYLON.Tools.ToRadians(40));
    }
  }

  toggleAutoRotate() {
    this.isAutoRotating = !this.isAutoRotating;
    return this.isAutoRotating;
  }

  updateRackStatus(rackName, status) {
    const rack = this.racks.get(rackName);
    if (!rack) return;

    rack.stockStatus = status;
    if (status === "low") {
      rack.beaconMat.diffuseColor = new BABYLON.Color3(0.95, 0.2, 0.25); // Crimson Red
      rack.beaconMat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.25);
    } else if (status === "medium") {
      rack.beaconMat.diffuseColor = new BABYLON.Color3(0.95, 0.65, 0.1);  // Amber
      rack.beaconMat.emissiveColor = new BABYLON.Color3(0.95, 0.65, 0.1);
    } else {
      rack.beaconMat.diffuseColor = new BABYLON.Color3(0.08, 0.8, 0.4);  // Emerald Green
      rack.beaconMat.emissiveColor = new BABYLON.Color3(0.08, 0.8, 0.4);
    }
  }

  // Visual Process Step Walkthrough (Step 1 to 4)
  playFlowStep(stepNum) {
    this.currentStep = stepNum;
    this.isAutoRotating = false;

    if (stepNum === 1) {
      // Step 1: Inbound Receiving Dock -> Main Store (+100 Steel)
      this.animateCameraTo(new BABYLON.Vector3(-18, 4, -5), 32, BABYLON.Tools.ToRadians(25), BABYLON.Tools.ToRadians(50));
      this.animateTransfer("Inbound Dock", "Main Store", 100, "Steel Rods");
      this.showProcessBanner(
        "STEP 1: INBOUND RECEIPT (VENDOR)",
        "Receive 100 kg Steel Rods from Tata Steel Ltd into Main Store.<br><b>Stock Impact: +100 units</b> recorded in PostgreSQL & Stock Ledger."
      );
    } else if (stepNum === 2) {
      // Step 2: Internal Transfer: Main Store -> Production Rack (25 kg)
      this.animateCameraTo(new BABYLON.Vector3(0, 4, -10), 32, BABYLON.Tools.ToRadians(90), BABYLON.Tools.ToRadians(45));
      this.animateTransfer("Main Store", "Production Rack", 25, "Steel Rods");
      this.showProcessBanner(
        "STEP 2: INTERNAL TRANSFER",
        "Move 25 kg Steel from Main Store to Production Rack for assembly.<br><b>Stock Impact: Main Store (-25), Production (+25)</b>. Total stock unchanged."
      );
    } else if (stepNum === 3) {
      // Step 3: Outbound Delivery: Production Rack -> Outbound Shipping Dock (-20)
      this.animateCameraTo(new BABYLON.Vector3(18, 4, -5), 32, BABYLON.Tools.ToRadians(155), BABYLON.Tools.ToRadians(50));
      this.animateTransfer("Production Rack", "Outbound Dock", 20, "Finished Goods");
      this.showProcessBanner(
        "STEP 3: CUSTOMER DELIVERY ORDER",
        "Deliver 20 units to customer Apex Corp.<br><b>Stock Impact: Stock decreases by -20</b> after pick, pack & validation."
      );
    } else if (stepNum === 4) {
      // Step 4: Physical Count Adjustment: 3 kg damaged in Audit Area
      this.animateCameraTo(new BABYLON.Vector3(0, 3, 18), 26, BABYLON.Tools.ToRadians(90), BABYLON.Tools.ToRadians(45));
      this.flashAuditDamagedItem();
      this.showProcessBanner(
        "STEP 4: PHYSICAL COUNT ADJUSTMENT",
        "Audit finds 3 kg damaged steel in handling.<br><b>Stock Impact: Net adjustment (-3)</b> fixes discrepancy and updates ledger."
      );
    } else {
      // Overview
      this.setCameraPreset("overview");
      this.hideProcessBanner();
    }
  }

  showProcessBanner(title, descriptionHtml) {
    let banner = document.getElementById("flowExplanationCard");
    if (!banner) return;
    document.getElementById("flowBannerTitle").textContent = title;
    document.getElementById("flowBannerDesc").innerHTML = descriptionHtml;
    banner.classList.remove("hidden");
    
    if (window.Motion) {
      Motion.animate(banner, { opacity: [0, 1], y: [20, 0], scale: [0.96, 1] }, { duration: 0.35, easing: "ease-out" });
    }
  }

  hideProcessBanner() {
    let banner = document.getElementById("flowExplanationCard");
    if (banner) banner.classList.add("hidden");
  }

  flashAuditDamagedItem() {
    const crate = this.scene.getMeshByName("damageCrate");
    if (crate && crate.material) {
      const origEmissive = crate.material.emissiveColor.clone();
      crate.material.emissiveColor = new BABYLON.Color3(1.0, 0.2, 0.2);
      setTimeout(() => {
        crate.material.emissiveColor = origEmissive;
      }, 1200);
    }
  }

  // 3D Material Transfer Animation (Pallet Carrier along Painted Lanes)
  animateTransfer(fromName, toName, quantity, productName) {
    const fromRack = this.racks.get(fromName);
    const toRack = this.racks.get(toName);

    let startPos = fromRack ? fromRack.position.clone() : new BABYLON.Vector3(-24, 0, 0);
    let endPos = toRack ? toRack.position.clone() : new BABYLON.Vector3(24, 0, 0);
    startPos.y = 0.45;
    endPos.y = 0.45;

    // Moving Pallet Cargo
    const carrier = BABYLON.MeshBuilder.CreateBox("movingPallet", { width: 2.0, height: 1.0, depth: 1.6 }, this.scene);
    carrier.position = startPos.clone();

    const carrierMat = new BABYLON.StandardMaterial("carrierMat", this.scene);
    carrierMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.9);
    carrierMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    carrier.material = carrierMat;

    // Intermediate Waypoint on Center Transit Highway
    const midPoint = new BABYLON.Vector3(0, 0.45, (startPos.z + endPos.z) / 2);

    const anim = new BABYLON.Animation("transferMovement", "position", 30, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    const keys = [
      { frame: 0, value: startPos },
      { frame: 35, value: midPoint },
      { frame: 70, value: endPos }
    ];
    anim.setKeys(keys);

    const easing = new BABYLON.CubicEase();
    easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
    anim.setEasingFunction(easing);

    carrier.animations.push(anim);

    this.scene.beginAnimation(carrier, 0, 70, false, 1.0, () => {
      setTimeout(() => {
        carrier.dispose();
      }, 400);

      // Flash destination rack beacon
      if (toRack) {
        toRack.beaconMat.emissiveColor = new BABYLON.Color3(1.0, 1.0, 1.0);
        setTimeout(() => this.updateRackStatus(toName, toRack.stockStatus), 600);
      }
    });
  }
}

// Global instance handle
window.warehouse3D = null;
