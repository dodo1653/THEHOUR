# Hourpad's hero object: a heavy LED clock. Brushed dark metal case, smoked glass front, a 5x7 dot-matrix of real
# orange LEDs (lit dots emit, unlit dots show as dark lenses). Renders the coin image or a count-down sequence.
# blender -b --factory-startup --python brand/ledclock.py -- still <out.png> [samples] [res] [text]
# blender -b --factory-startup --python brand/ledclock.py -- count <outdir> [samples] [res]   (frames for the film)
import bpy, math, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = argv[0] if argv else "still"
OUT = os.path.abspath(argv[1]) if len(argv) > 1 else os.path.abspath("clock.png")
SAMPLES = int(argv[2]) if len(argv) > 2 else 256
RES = int(argv[3]) if len(argv) > 3 else 1500
TEXT = argv[4] if len(argv) > 4 else "00:00"
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene

FONT = {  # 5 x 7 dot-matrix glyphs, top row first
    "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ":": ["0", "0", "1", "0", "1", "0", "0"],
}

def mat(name, color, rough=0.4, metal=0.0, emit=None, strength=0.0, coat=0.0, aniso=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        k = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[k].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = strength
    if coat:
        c = b.inputs.get("Coat Weight") or b.inputs.get("Clearcoat"); c.default_value = coat
    if aniso and "Anisotropic" in b.inputs: b.inputs["Anisotropic"].default_value = aniso
    return m, m.node_tree, b

# brushed dark metal: streaky noise drives roughness and a fine bump
case_m, cnt, cb = mat("case", (0.035, 0.034, 0.033), 0.32, 1.0, aniso=0.6)
nz = cnt.nodes.new("ShaderNodeTexNoise"); mp = cnt.nodes.new("ShaderNodeMapping"); tc = cnt.nodes.new("ShaderNodeTexCoord")
mp.inputs["Scale"].default_value = (90, 1.5, 90); nz.inputs["Detail"].default_value = 12
cnt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); cnt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
mr = cnt.nodes.new("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.22; mr.inputs["To Max"].default_value = 0.42
cnt.links.new(nz.outputs["Fac"], mr.inputs["Value"]); cnt.links.new(mr.outputs["Result"], cb.inputs["Roughness"])
bp = cnt.nodes.new("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.08
cnt.links.new(nz.outputs["Fac"], bp.inputs["Height"]); cnt.links.new(bp.outputs["Normal"], cb.inputs["Normal"])
face_m = mat("face", (0.01, 0.01, 0.011), 0.6)[0]
lens_m = mat("lens", (0.022, 0.012, 0.008), 0.22, coat=1.0)[0]               # an unlit LED: dark amber lens
led_m, _, led_b = mat("led", (1.0, 0.25, 0.02), 0.3, emit=(1.0, 0.17, 0.01), strength=6.0)
glass_m, gnt, gb = mat("glass", (0.02, 0.02, 0.02), 0.04)
gb.inputs["Alpha"].default_value = 0.16
t = gb.inputs.get("Transmission Weight") or gb.inputs.get("Transmission"); t.default_value = 0.0
bolt_m = mat("bolt", (0.6, 0.6, 0.62), 0.25, 1.0)[0]

def rbox(name, size, loc, m, bevel=0.06, seg=6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new("bev", "BEVEL"); b.width = bevel; b.segments = seg; b.limit_method = "ANGLE"
    o.data.materials.append(m); bpy.ops.object.shade_smooth()
    try: bpy.ops.object.shade_auto_smooth()
    except Exception: pass
    return o

# the case: a deep slab, the screen recessed into it
SHOWN = TEXT if MODE in ("still", "cutout") else "59:57"
COLS = 1 + sum(len(FONT[ch][0]) + 1 for ch in SHOWN)     # glyphs, a gap after each, a margin
PITCH = 0.15
W, H = COLS * PITCH + 0.9, 7 * PITCH + 0.9
rbox("case", (W, 0.9, H), (0, 0, 0), case_m, 0.12, 8)
rbox("bezel", (W - 0.32, 0.06, H - 0.32), (0, -0.44, 0), face_m, 0.03, 3)
glass = rbox("glass", (W - 0.36, 0.02, H - 0.36), (0, -0.55, 0), glass_m, 0.01, 2)
for sx in (-1, 1):
    for sz in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.04, location=(sx * (W / 2 - 0.1), -0.475, sz * (H / 2 - 0.1)), rotation=(math.radians(90), 0, 0))
        bpy.context.active_object.data.materials.append(bolt_m); bpy.ops.object.shade_smooth()
# feet
for sx in (-1, 1):
    rbox("foot", (0.5, 0.7, 0.12), (sx * (W / 2 - 0.5), 0, -H / 2 - 0.05), face_m, 0.04, 3)

# the LED matrix: one dot mesh, linked copies
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, segments=20, ring_count=10, location=(0, 0, 0))
proto = bpy.context.active_object; proto.scale = (1, 0.45, 1); bpy.ops.object.transform_apply(scale=True); bpy.ops.object.shade_smooth()
proto.data.materials.append(lens_m)
dots = {}
def build_dots():
    x0 = -((COLS - 1) * PITCH) / 2
    for c in range(COLS):
        for r in range(7):
            o = proto.copy(); o.data = proto.data.copy(); sc.collection.objects.link(o)
            o.location = (x0 + c * PITCH, -0.495, (3 - r) * PITCH)
            dots[(c, r)] = o
    bpy.data.objects.remove(proto)
build_dots()

def show(text):
    # columns: d d : d d, each digit 5 wide with a 1-column gap, the colon 1 wide with gaps
    lit = set(); c = 1
    for ch in text:
        g = FONT[ch]; w = len(g[0])
        for r in range(7):
            for i in range(w):
                if g[r][i] == "1": lit.add((c + i, r))
        c += w + 1
    for k, o in dots.items():
        o.data.materials[0] = led_m if k in lit else lens_m

# the set: a dark textured floor and a faint warm wall; the LEDs light everything else
floor_m, fnt, fb = mat("floor", (0.012, 0.011, 0.01), 0.55)
fz = fnt.nodes.new("ShaderNodeTexNoise"); fz.inputs["Scale"].default_value = 6; fz.inputs["Detail"].default_value = 10
fbp = fnt.nodes.new("ShaderNodeBump"); fbp.inputs["Strength"].default_value = 0.15
fnt.links.new(fz.outputs["Fac"], fbp.inputs["Height"]); fnt.links.new(fbp.outputs["Normal"], fb.inputs["Normal"])
if MODE != "cutout": bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -H / 2 - 0.11)); bpy.context.active_object.data.materials.append(floor_m)
wall_m = mat("wall", (0.02, 0.016, 0.014), 0.8)[0]
if MODE != "cutout": bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 6, 0), rotation=(math.radians(90), 0, 0)); bpy.context.active_object.data.materials.append(wall_m)

def area(name, loc, target, size, power, color):
    l = bpy.data.lights.new(name, "AREA"); l.size = size; l.energy = power; l.color = color
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
area("key", (-5, -6, 6), (0, 0, 0), 5, 900, (1.0, 0.92, 0.85))
area("rim", (5, 4, 4), (0, 0, 0), 3, 900, (1.0, 0.6, 0.3))
area("edge", (-6, 2, 1), (0, 0, 0), 3, 500, (0.8, 0.85, 1.0))
area("top", (0, -1, 7), (0, 0, 0), 6, 120, (0.85, 0.9, 1.0))
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.003, 0.003, 0.004, 1)

cam = bpy.data.cameras.new("cam"); cam.lens = 70; cam.dof.use_dof = True; cam.dof.aperture_fstop = 3.2
co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
def aim(loc, target=(0, -0.4, 0.05)):
    co.location = loc; co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.dof.focus_distance = (Vector(target) - Vector(loc)).length

sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dt in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dt; prefs.get_devices()
            if any(d.type == dt for d in prefs.devices):
                for d in prefs.devices: d.use = d.type == dt
                sc.cycles.device = "GPU"; break
        except TypeError: pass
except Exception: pass
sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.render.image_settings.file_format = "PNG"
try: sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
except TypeError: pass
# a soft bloom around the LEDs (compositor glare)
sc.use_nodes = True
try:
    tree = sc.node_tree; rl = tree.nodes.get("Render Layers") or tree.nodes.new("CompositorNodeRLayers"); comp = tree.nodes.get("Composite") or tree.nodes.new("CompositorNodeComposite")
    gl = tree.nodes.new("CompositorNodeGlare"); gl.glare_type = "FOG_GLOW"; gl.quality = "HIGH"; gl.threshold = 1.2; gl.size = 7
    try: gl.mix = -0.55
    except Exception: pass
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"]); tree.links.new(gl.outputs["Image"], comp.inputs["Image"])
except Exception as e: print("no glare", e)

if MODE == "cutout":
    # the site's hero object: the clock alone on a transparent background
    sc.render.resolution_x, sc.render.resolution_y = RES, RES * 3 // 4
    sc.render.film_transparent = True; sc.render.image_settings.color_mode = "RGBA"
    show(TEXT); aim((-1.25, -7.0, 0.7)); cam.lens = 60; cam.dof.use_dof = False
    sc.render.filepath = OUT; bpy.ops.render.render(write_still=True)
elif MODE == "still":
    sc.render.resolution_x = sc.render.resolution_y = RES
    show(TEXT); aim((-0.95, -5.7, 0.95)); cam.lens = 55
    sc.render.filepath = OUT; bpy.ops.render.render(write_still=True)
else:
    # the count-down for the film: 59:57 .. 00:00, a slow push in, then the hour lands
    sc.render.resolution_x, sc.render.resolution_y = RES, RES * 9 // 16
    os.makedirs(OUT, exist_ok=True)
    seq = [("59:57", 14), ("59:58", 14), ("59:59", 14), ("00:00", 30)]
    f = 0; total = sum(n for _, n in seq)
    for text, n in seq:
        show(text)
        for k in range(n):
            p = f / (total - 1); e = 1 - (1 - p) ** 2
            aim((-3.0 + 1.6 * e, -12.5 + 3.4 * e, 2.6 - 0.6 * e)); cam.lens = 60 + 6 * e
            if text == "00:00":   # the hour: the LEDs flare, then settle
                led_b.inputs["Emission Strength"].default_value = 6 + 30 * math.exp(-k / 4)
            sc.render.filepath = os.path.join(OUT, "c%03d.png" % f); bpy.ops.render.render(write_still=True); f += 1
print("done", MODE)
