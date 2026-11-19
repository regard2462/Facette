// SPDX-License-Identifier: AGPL-3.0-or-later
import * as THREE from 'three';
import {
	pass, mrt, output, normalView, velocity, packNormalToRGB, unpackRGBToNormal, sample, uniform,
	vec2, vec3, vec4, float, max, dot, metalness, roughness, renderOutput, positionWorld, screenUV, mix, smoothstep, length, reflector, select,
	convertToTexture, cubeTexture, screenSize
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { buildStudio } from './studio.js';
import { layDown, METALS } from './ring.js';
import { shared, STONE_BY_ID, GemMaterial } from './gem.js';
import { buildDesign, DEFAULT_DESIGN, STYLES, PROFILES, CARAT_RANGE, styleDefaults } from './design.js';
import { BAND_CHOICES, BAND_RANGES } from './band.js';
import { PAVE_RANGES } from './pave.js';
import { CUTS } from './gemcut.js';
import { GEMSTONES } from './library.js';
import { finishMaterial } from './finish.js';
import { LightGizmo } from './gizmo.js';
import { Caustics } from './caustics.js';
import { lensBlur } from './lensblur.js';

const params = new URLSearchParams( location.search );
if ( params.has( 'trace' ) ) THREE.Node.captureStackTrace = true;
const canvas = document.getElementById( 'view' );
const status = document.getElementById( 'status' );

const QUALITY = {
	low: { ratio: 1, bounces: 3, grid: 96, ao: 0.5, shadow: 1024, ssr: false, dof: 64 },
	mid: { ratio: 1.5, bounces: 5, grid: 192, ao: 0.5, shadow: 2048, ssr: true, dof: 80 },
	high: { ratio: 2, bounces: 7, grid: 320, ao: 1, shadow: 2048, ssr: true, dof: 128 }
};

const state = {
	quality: 'mid',
	dark: params.get( 'scene' ) === 'dark',
	dof: params.get( 'dof' ) !== '0',
	ssr: params.get( 'ssr' ) !== '0',
	ao: params.get( 'ao' ) !== '0',
	play: false,
	az: 40, el: 55, env: 0,
	// Stone types from the library: center stone and accent stones (side stones and pavé)
	metal: 'platinum', center: 'lab-diamond', side: 'lab-diamond',
	design: structuredClone( DEFAULT_DESIGN )
};

// frames drawn and frames without change; wake() restarts the loop after a standstill
let frames = 0, still = 0;
const wake = () => { still = 0; };

// ---------- Renderer

const renderer = new THREE.WebGPURenderer( { canvas, antialias: false, forceWebGL: params.has( 'webgl' ) } );

try {

	await renderer.init();

} catch ( e ) {

	window.fail?.( 'This browser supports neither WebGPU nor WebGL 2.' );
	throw e;

}

const isWebGPU = renderer.backend.isWebGPUBackend === true;
const wanted = params.get( 'q' );
state.quality = Object.hasOwn( QUALITY, wanted ) ? wanted : ( isWebGPU ? 'mid' : 'low' );
// Without a fixed choice the view steps down when the device is too slow (see measure)
let autoQuality = ! Object.hasOwn( QUALITY, wanted );

// Lost GPU (driver restart, out of memory): show a message instead of a frozen image
renderer.onDeviceLost = ( info ) => {

	console.error( 'Graphics device lost:', info?.message );
	document.body.classList.remove( 'ready' );
	window.fail?.( 'The graphics card was reset. Please reload the page.' );

};

// Errors that can leave the image incomplete: report once visibly instead of continuing silently
let noticed = false;
function notify( text ) {

	if ( noticed ) return;
	noticed = true;
	const n = document.getElementById( 'notice' );
	n.textContent = text;
	n.hidden = false;

}

// WebGPU: shader and pipeline errors arrive as uncaptured device errors
renderer.onError = ( err ) => {

	console.error( 'Graphics error:', err?.type, err?.message );
	notify( err?.type === 'GPUOutOfMemoryError'
		? 'Not enough graphics memory. Choose a lower quality or reload the page.'
		: 'A graphics error occurred, the view may be incomplete. Please reload the page.' );

};

// WebGL: shader compile error (replaces three's own output, so log it here)
renderer.debug.onShaderError = ( gl, program, vs, fs ) => {

	console.error( 'Shader error:', gl.getProgramInfoLog( program ), gl.getShaderInfoLog( vs ), gl.getShaderInfoLog( fs ) );
	notify( 'A shader could not be compiled, the view may be incomplete.' );

};

renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
// Long focal length like in a studio: the ring fills about 70 % of the image width in the
// overview, as in product photos, without moving the camera closer. Distances, and with them
// the depth of field, stay as with 20°.
const camera = new THREE.PerspectiveCamera( 16, 1, 0.05, 80 );
const controls = new OrbitControls( camera, canvas );
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 1.2;
controls.maxDistance = 30; // portrait with a long focal length needs up to about 25
controls.maxPolarAngle = Math.PI * 0.492;
controls.enablePan = false;

// ---------- Studio (procedural)

// Metal sees the studios without spark lights, the stones (through the probe) see the setting too
const studios = {
	light: buildStudio( renderer ),
	dark: buildStudio( renderer, { dark: true } ),
	gem: buildStudio( renderer, { sparks: true, size: 256, lights: 2.6 } )
};
const bgColor = uniform( new THREE.Color() );
// One fixed node for both cases: switching between color and cube texture would rebuild the
// background twice on every probe capture. The probe only toggles probeBg.
const probeBg = uniform( 0 );
scene.backgroundNode = mix( bgColor, cubeTexture( studios.gem.texture ).rgb, probeBg );

// ---------- Ring

// Gold curve: in product photos dark gold tones fade to brown-orange and bright ones get paler,
// like a film tone mapping. Applied to the metal only, the stones stay neutral.
// metalWarm comes from METALS (0 for white metals, which leaves the color unchanged).
const metalWarm = uniform( 0 );
const grade = {
	dark: uniform( new THREE.Vector2( 0.03, 0.4 ) ), // brightness below which shadows turn warm
	tint: uniform( new THREE.Vector3( 1, 0.88, 0.96 ) ), // shadow color (factor per channel)
	bright: uniform( new THREE.Vector2( 0.35, 1.6 ) ), // brightness above which bright tones get paler
	pale: uniform( 0.3 ),
	// Soft-limit highlights: above knee the brightness only grows up to knee + range,
	// so glossy areas keep a warm light yellow (setScene sets knee per studio)
	knee: uniform( 0.45 ),
	range: uniform( 0.6 )
};
const metalGrade = ( m ) => {

	const c = output.rgb, lum = max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 );
	const over = max( lum.sub( grade.knee ), 0 );
	const squeeze = mix( float( 1 ), lum.min( grade.knee ).add( over.div( over.div( grade.range ).add( 1 ) ) ).div( lum ), metalWarm );
	const cs = c.mul( squeeze ), ls = lum.mul( squeeze );
	const dark = smoothstep( grade.dark.x, grade.dark.y, ls ).oneMinus().mul( metalWarm );
	const bright = smoothstep( grade.bright.x, grade.bright.y, ls ).mul( metalWarm ).mul( grade.pale );
	const warmed = cs.mul( mix( vec3( 1 ), grade.tint, dark ) );
	m.outputNode = vec4( mix( warmed, vec3( ls ), bright ), output.a );
	return m;

};

const metal = metalGrade( new THREE.MeshPhysicalNodeMaterial( { metalness: 1, roughness: METALS.platinum.roughness, color: new THREE.Color( METALS.platinum.color ) } ) );

// Stone materials per slot. The ring editor rebuilds with the same materials: a different
// cut only sets uniforms, shaders, probes and caustics stay in place.
const pool = new Map();
function poolMaterial( key, cut ) {

	let m = pool.get( key );
	if ( ! m ) { m = new GemMaterial( cut, STONE_BY_ID[ state.side ] ); pool.set( key, m ); }
	else if ( m.cut !== cut ) m.setCut( cut );
	return m;

}

// Band material per finish, polished is the metal itself
const finishes = {};
const bandMetal = ( kind ) => kind === 'polished' ? metal : ( finishes[ kind ] ??= metalGrade( finishMaterial( kind ) ) );

const designRing = () => buildDesign( state.design, { material: poolMaterial, metal, bandMetal: bandMetal( state.design.band.finish ), stone: state.center } );
// Ring and stones change with the design and when a custom model is loaded
let { ring, gems } = designRing();
// Width of the default ring before laying it down: loaded models are scaled to this size
const REF_WIDTH = new THREE.Box3().setFromObject( ring ).getSize( new THREE.Vector3() ).x;
layDown( ring );
const turn = new THREE.Group();
turn.add( ring );
scene.add( turn );

const focus = new THREE.Vector3();
const frameRing = () => { turn.updateMatrixWorld( true ); new THREE.Box3().setFromObject( turn ).getCenter( focus ); };
frameRing();
controls.target.copy( focus );

// ---------- Light

// The key light only provides shadows and caustics. The metal already shows its highlight
// through the studio softbox, an extra point would be a harsh spot on polished metal.
const key = new THREE.DirectionalLight( 0xffffff, 0 );
key.castShadow = true;
key.shadow.camera.left = key.shadow.camera.bottom = - 2.6;
key.shadow.camera.right = key.shadow.camera.top = 2.6;
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
key.shadow.bias = - 0.0004;
key.shadow.normalBias = 0.01;
key.shadow.radius = 12;
key.shadow.blurSamples = 24;
// the shadow map is only re-rendered on changes
key.shadow.autoUpdate = false;
key.shadow.needsUpdate = true;
scene.add( key, key.target );
key.target.position.copy( focus ).setY( 0 );

// The studio key light sits at 40°. When the light follows the gizmo the studio rotates with
// it, otherwise the highlight in the metal sits somewhere other than the shadow.
function applyEnvRot() {

	scene.environmentRotation.y = ( state.env + state.az - 40 ) * Math.PI / 180;
	scene.backgroundRotation.y = scene.environmentRotation.y;
	probeDirty = true;
	// Light and studio are mostly dragged: for a short time only the center probe each frame
	probeBusyUntil = performance.now() + 250;

}

function setLight() {

	const a = state.az * Math.PI / 180, e = state.el * Math.PI / 180;
	const d = new THREE.Vector3( Math.sin( a ) * Math.cos( e ), Math.sin( e ), Math.cos( a ) * Math.cos( e ) );
	shared.lightDir.value.set( d.x, d.y, d.z, 0 );
	applyEnvRot();
	key.position.copy( key.target.position ).addScaledVector( d, 9 );
	key.shadow.needsUpdate = true;
	caustics.dirty = true;
	probeDirty = true;

}

// ---------- Caustics

const caustics = new Caustics( renderer, { size: 1024, extent: 4.5 } );
caustics.center.value.copy( focus ).setY( 0 );

// ---------- Ground: shadow catcher, caustics, reflection in the dark studio

const groundColor = uniform( new THREE.Color() );
const shadowStrength = uniform( 0.5 );
const reflGain = uniform( 0 );
const causticTint = uniform( 1 );

class GroundModel extends THREE.LightingModel {

	constructor( compose ) {

		super();
		this.compose = compose;
		this.shadowNode = float( 1 ).toVar( 'groundShadow' );

	}

	direct( { lightNode } ) {

		if ( lightNode.shadowNode !== null ) this.shadowNode.mulAssign( lightNode.shadowNode );

	}

	finish( { context } ) {

		context.outgoingLight.rgb.assign( this.compose( this.shadowNode ) );

	}

}

class GroundMaterial extends THREE.MeshBasicNodeMaterial {

	constructor( compose ) {

		super();
		this.lights = true;
		this.compose = compose;

	}

	setupLightingModel() {

		return new GroundModel( this.compose );

	}

}

// A small mip level alone is magnified strongly and shows blocks. Nine offset taps in two
// rings smooth it into a soft, blurred reflection.
function softReflection( refl ) {

	const uv0 = screenUV.flipX(); // like the reflector itself
	const px = vec2( 1 ).div( screenSize );
	let sum = refl.sample( uv0 ).level( 3.2 ).rgb;

	for ( let k = 0; k < 8; k ++ ) {

		const a = k * Math.PI / 4 + 0.39, r = k % 2 ? 24 : 11;
		sum = sum.add( refl.sample( uv0.add( px.mul( vec2( Math.cos( a ) * r, Math.sin( a ) * r ) ) ) ).level( 3.2 ).rgb );

	}

	return sum.div( 9 );

}

function makeGround( withReflection ) {

	let refl = null;

	if ( withReflection ) {

		// Mipmaps keep the floor reflection soft and blurred
		refl = reflector( { resolutionScale: 0.5, generateMipmaps: true } );
		refl.target.rotateX( - Math.PI / 2 );
		scene.add( refl.target );

	}

	const mat = new GroundMaterial( ( shadow ) => {

		const dist = length( positionWorld.xz.sub( caustics.center.xz ) );
		const sh = mix( float( 1 ), shadow, shadowStrength );
		let col = groundColor.mul( sh );
		col = col.add( caustics.sample( positionWorld ).mul( causticTint ).mul( mix( float( 0.35 ), float( 1 ), shadow ) ) );
		if ( refl ) col = col.add( softReflection( refl ).mul( reflGain ).mul( smoothstep( 1.5, 6, dist ).oneMinus() ) );
		return mix( col, bgColor, smoothstep( 6, 14, dist ) );

	} );

	const mesh = new THREE.Mesh( new THREE.CircleGeometry( 30, 64 ), mat );
	mesh.rotation.x = - Math.PI / 2;
	mesh.receiveShadow = true;
	return mesh;

}

const grounds = { light: makeGround( false ), dark: makeGround( true ) };
scene.add( grounds.light, grounds.dark );

// Caustics for the current ring. Only after setupProbes, which gives side stones their own materials.
function attachCaustics() {

	caustics.clear();
	// Pavé sits in the metal: its light cannot exit at the bottom, so no photons
	for ( const g of gems ) if ( g.group !== 'pave' ) caustics.add( g.mesh, g.mesh.material );
	// Prongs and band occlude photons
	ring.traverse( ( o ) => { if ( o.isMesh && ( o.material === metal || o.material.finish ) ) caustics.addOccluder( o ); } );

}

// ---------- Switch scene

// Against black, polished metal reflects almost only darkness. The softboxes of the dark studio
// therefore count more in the metal. Gold gets less of it, so its glossy areas keep a warm
// light yellow.
const DARK_LIGHT = { white: 1.8, gold: 1.6 };
// In the light tent almost all the metal is bright, so the curve limits late there
const GRADE_KNEE_LIGHT = 0.9;
function metalLight() {

	const w = METALS[ state.metal ].warm;
	scene.environmentIntensity = state.dark ? DARK_LIGHT.white + ( DARK_LIGHT.gold - DARK_LIGHT.white ) * w : 1;

}

function setScene() {

	const d = state.dark;
	const rt = d ? studios.dark : studios.light;
	scene.environment = rt.texture;
	metalLight();
	bgColor.value.set( d ? '#020202' : '#e6e6e3' );
	groundColor.value.set( d ? '#020202' : '#e6e6e3' );
	shadowStrength.value = d ? 0 : 0.45;
	// faint, soft sheen under the ring in the dark studio
	reflGain.value = d ? 0.06 : 0;
	grade.knee.value = d ? 0.45 : GRADE_KNEE_LIGHT;
	causticTint.value = d ? 0.12 : 0.85;
	shared.contrast.value = d ? 1.45 : 1.5;
	shared.envGain.value = 1;
	shared.lightGain.value = d ? 80 : 40;
	grounds.light.visible = ! d;
	grounds.dark.visible = d;
	document.body.classList.toggle( 'dark', d );
	probeDirty = true;

}

// ---------- Probes: what the stones see (studio, metal, light ground, neighboring stones)
// One probe at the center stone for center and pavé, a smaller one per side stone. Other stones
// appear in it as a faceted mirror in their color. No probe sees its own stone: it sits inside
// it, and from inside all faces point backward and are culled.

const cubeOpts = { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter };
const probeRT = new THREE.CubeRenderTarget( 256, cubeOpts );
const probeCam = new THREE.CubeCamera( 0.02, 60, probeRT );
shared.envTex = probeRT.texture; // needed before the first shader build
let probeDirty = true, probeTick = 0, probes = [];
// While the turntable runs or the light is dragged the side probes update only every third time, then once fully afterwards
let probeBusyUntil = 0, sidesStale = false;
const probeDark = { value: 0.7 };
const standIns = new Map();

// Stand-in for a stone in the probes. The real stone shader reads a probe itself and must
// not draw into it.
function standIn( gm ) {

	let m = standIns.get( gm );
	if ( m ) return m;
	m = new THREE.MeshStandardNodeMaterial( { metalness: 1, roughness: 0.06 } );
	m.envMap = studios.gem.texture;
	m.colorNode = mix( vec3( 1 ), gm.tint, 0.85 );
	standIns.set( gm, m );
	return m;

}

// At most four side stones get their own probe, further ones see the center stone's probe
function setupProbes() {

	probes = gems.length ? [ { cam: probeCam, gem: gems[ 0 ] } ] : [];
	const taken = new Set();
	const spare = new Map(); // per shared material one without its own probe, for stones above the limit

	for ( const g of gems ) {

		if ( g.group !== 'side' ) continue;
		let mat = g.mesh.material;

		if ( probes.length > 4 ) {

			// the shared material already carries another stone's probe
			if ( mat.envTex ) {

				if ( ! spare.has( mat ) ) spare.set( mat, new GemMaterial( mat.cut, mat.stone ) );
				g.mesh.material = spare.get( mat );

			}

			continue;

		}

		// The probe belongs to the material: if side stones share one, each gets its own
		if ( taken.has( mat ) ) { mat = new GemMaterial( mat.cut, mat.stone ); g.mesh.material = mat; }
		taken.add( mat );

		// The shader reads the probe on first build, so it stays on the material
		if ( ! mat.probeRT ) {

			mat.probeRT = new THREE.CubeRenderTarget( 128, cubeOpts );
			mat.envTex = mat.probeRT.texture;

		}

		probes.push( { cam: new THREE.CubeCamera( 0.02, 60, mat.probeRT ), gem: g } );

	}

	probeDirty = true;

}

// sides = false: only the center stone probe (turntable, the sides follow every few frames)
function updateProbes( sides = true ) {

	probeDirty = false;
	sidesStale = ! sides && probes.length > 1;
	const list = sides ? probes : probes.slice( 0, 1 );
	if ( ! list.length ) return;
	const own = gems.map( g => g.mesh.material );
	for ( const g of gems ) g.mesh.material = standIn( g.mesh.material );
	const darkGround = grounds.dark.visible;
	grounds.dark.visible = false; // its reflection would be re-rendered per cube face
	const rt = renderer.getRenderTarget(), m = renderer.getMRT();
	// Stones need a bright surrounding even in the dark studio, otherwise they stay black
	probeBg.value = 1;
	scene.backgroundIntensity = state.dark ? probeDark.value : 1;

	try {

		renderer.setMRT( null );

		for ( const p of list ) {

			p.gem.mesh.getWorldPosition( p.cam.position );
			p.cam.update( renderer, scene );

		}

	} finally {

		renderer.setMRT( m );
		renderer.setRenderTarget( rt );
		probeBg.value = 0;
		scene.backgroundIntensity = 1;
		grounds.dark.visible = darkGround;
		gems.forEach( ( g, i ) => { g.mesh.material = own[ i ]; } );

	}

}

setupProbes();
attachCaustics();

// ---------- Post-processing

const pipeline = new THREE.RenderPipeline( renderer );
// fixed MRT nodes: a new node per rebuild would rebuild all scene shaders
const MRT_GL = mrt( { output, normal: packNormalToRGB( normalView ) } );
const MRT_BASE = mrt( { output, normal: packNormalToRGB( normalView ), velocity } );
const MRT_SSR = mrt( { output, normal: packNormalToRGB( normalView ), velocity, metalrough: vec2( metalness, roughness ) } );
let owned = [];
let settleUntil = 0; // the first frames after a rebuild do not count for the frame rate
const focusDist = uniform( 5 );
const focusRange = uniform( 0.6 );
const bokeh = uniform( 1.3 );
let scenePass, lens = null;

function buildPipeline() {

	for ( const n of owned ) n.dispose?.();
	owned = [];
	const own = ( n ) => { owned.push( n ); return n; };

	const q = QUALITY[ state.quality ];
	scenePass = own( pass( scene, camera ) );
	const useSSR = isWebGPU && q.ssr && state.ssr;
	scenePass.setMRT( ! isWebGPU ? MRT_GL : useSSR ? MRT_SSR : MRT_BASE );

	const color = scenePass.getTextureNode( 'output' );
	const depth = scenePass.getTextureNode( 'depth' );
	const normalTex = scenePass.getTextureNode( 'normal' );
	const normal = sample( ( p ) => unpackRGBToNormal( normalTex.sample( p ) ) );

	// Screen-space ambient occlusion (GTAO): contact shadows in settings and on the ground
	const aoPass = own( ao( depth, normal, camera ) );
	aoPass.resolutionScale = q.ao;
	aoPass.radius.value = 0.22;
	aoPass.thickness.value = 1.2;
	// GTAO samples with a fixed 4x4 pattern. Unfiltered it draws dashes on thin edges; the
	// filter smooths spatially, with TRAA the pattern also changes per frame.
	aoPass.useTemporalFiltering = isWebGPU;
	const aoTex = own( denoise( aoPass.getTextureNode(), depth, normal, camera ) );
	// Background (depth 1) stays unoccluded
	const far = smoothstep( 7, 14, scenePass.getViewZNode().negate() );
	const occ = select( depth.r.greaterThanEqual( 0.99999 ), float( 1 ), mix( mix( float( 1 ), aoTex.r, 0.9 ), float( 1 ), far ) );
	let lit = color;

	if ( useSSR ) {

		// Screen-space reflections: metal shows stones, prongs and its own band
		const mr = scenePass.getTextureNode( 'metalrough' );
		// binaryRefine bisects the hit between two steps: without it the band under the center
		// stone draws stair steps like a thread at a grazing view.
		const ssrPass = own( ssr( color, depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, camera, binaryRefine: true } ) );
		ssrPass.maxDistance.value = 1.6;
		ssrPass.thickness.value = 0.015;
		ssrPass.quality.value = 0.7;
		ssrPass.resolutionScale = 1;
		// The RGB is already weighted with metalness and Fresnel, alpha carries the hit
		// distance and is not usable as opacity: so add.
		lit = vec4( color.rgb.add( ssrPass.getTextureNode().rgb.mul( 0.8 ) ), 1 );

	}

	// Keep as a texture: the AO denoise filter is part of this expression and would otherwise be
	// recomputed in every pass that reads the image (bloom, depth of field, FXAA).
	// Create the intermediate textures here so they are disposed with the rebuild.
	let img = own( convertToTexture( vec4( state.ao ? lit.rgb.mul( occ ) : lit.rgb, 1 ) ) );

	// temporal anti-aliasing, also calms the sparkle in the stones
	if ( isWebGPU ) img = own( traa( img, depth, scenePass.getTextureNode( 'velocity' ), camera ) );

	// The glow always sees the full HDR image, independent of the depth of field
	const hdr = img;
	const glow = own( bloom( hdr, 0.13, 0.3, 2.6 ) );
	let base = hdr.rgb;

	// Depth of field is only built when on: switched off it costs nothing
	if ( state.dof ) {

		// Limit highlights color-true for the blur only, otherwise they become harsh discs.
		// Sharp areas come unchanged from the HDR image.
		const peak = max( hdr.r, max( hdr.g, hdr.b ) ).max( 1e-4 );
		const soft = own( convertToTexture( vec4( hdr.rgb.mul( float( 2.5 ).div( peak ).min( 1 ) ), 1 ) ) );
		lens = own( lensBlur( soft, depth, scenePass._cameraNear, scenePass._cameraFar, focusDist, focusRange, bokeh, q.dof, hdr ) );
		base = lens.rgb;

	} else lens = null;

	const vig = smoothstep( 0.35, 1.25, length( screenUV.sub( 0.5 ).mul( vec2( 1.1, 1.3 ) ) ) ).oneMinus();
	const out = vec4( base.add( glow.rgb ).mul( mix( float( 0.86 ), float( 1 ), vig ) ), 1 );

	// FXAA needs the finished sRGB image, so tone curve first, then smoothing
	pipeline.outputColorTransform = isWebGPU;
	pipeline.outputNode = isWebGPU ? out : own( fxaa( own( convertToTexture( renderOutput( out ) ) ) ) );
	pipeline.needsUpdate = true;
	settleUntil = frames + 40;
	wake();

}

// ---------- Apply state

function setQuality() {

	const q = QUALITY[ state.quality ];
	shared.bounces.value = q.bounces;
	caustics.setGrid( q.grid );
	key.shadow.mapSize.set( q.shadow, q.shadow );
	key.shadow.needsUpdate = true;
	buildPipeline();
	resize();

}

function setMaterials() {

	const m = METALS[ state.metal ];
	metal.color.set( m.color );
	metal.roughness = m.roughness;
	metalWarm.value = m.warm;
	metalLight();
	for ( const f of Object.values( finishes ) ) f.color.set( m.color );
	// Accent stones are side stones and pavé. Side stones each have their own material (own probe).
	for ( const g of gems ) {

		const gm = g.mesh.material;
		gm.setStone( STONE_BY_ID[ g.group === 'center' ? state.center : state.side ] );
		gm.setting.value.set( m.color );

	}

	caustics.dirty = true;
	key.shadow.needsUpdate = true;
	probeDirty = true;

}

function resize() {

	const w = canvas.clientWidth, h = canvas.clientHeight;
	if ( w === 0 || h === 0 ) return;
	const ratio = Math.min( window.devicePixelRatio, QUALITY[ state.quality ].ratio );
	if ( renderer.getPixelRatio() !== ratio ) renderer.setPixelRatio( ratio );
	renderer.setSize( w, h, false );
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	panelShift();
	refit();
	wake();

}

// Adjust the distance as goView would for this aspect ratio and this panel
// (phone rotated, design panel open or closed)
function refit() {

	const n = narrowFor();
	if ( n === narrowNow ) return;
	camera.position.sub( controls.target ).multiplyScalar( n / narrowNow ).add( controls.target );
	if ( fly ) fly.pos.sub( fly.target ).multiplyScalar( n / narrowNow ).add( fly.target );
	narrowNow = n;

}

// right edge of the open design panel; in portrait it lies at the bottom and does not count
const panelRight = () => {

	const p = document.getElementById( 'config-panel' );
	return p && ! p.hidden && innerWidth > 640 ? p.getBoundingClientRect().right : 0;

};

// narrow windows: increase the distance so the ring fits between the button bars on the left
// and right (about 60 px each). At 16:10 the overview fills 70 % of the width (1.125 / 1.6).
// With the panel open this applies to the free width to its right.
const narrowFor = () => {

	const w = Math.max( canvas.clientWidth, 300 ), free = Math.max( w - panelRight(), 300 );
	const want = Math.min( 0.7, 1 - 150 / free ) * free / w;
	return Math.min( Math.max( 1, 1.125 / ( camera.aspect * want ) ), 4 );

};
let narrowNow = 1;

// ---------- Views

const VIEWS = [
	// slightly offset sideways: the ring sits centered between the view buttons and the tool bar
	{ pos: [ 3.237, 2.5, 5.521 ], target: [ 0.137, 0.25, 0.121 ] },
	{ pos: [ 0.011, 11.14, 1.475 ], target: [ 0, 0.2, 0.115 ] },
	{ pos: [ 1.2, 1.0, 3.9 ], target: [ 0, 0.42, 1.0 ] },
	{ pos: [ - 6.666, 1.28, 3.751 ], target: [ - 0.066, 0.3, 0.081 ] }
];

let fly = null;
// after a camera jump set the focus immediately instead of easing
let snapFocus = true;
const reduceMotion = matchMedia( '(prefers-reduced-motion: reduce)' );
const markViews = ( i ) => document.querySelectorAll( '[data-view]' ).forEach( b => {

	const on = Number( b.dataset.view ) === i;
	b.classList.toggle( 'on', on );
	b.setAttribute( 'aria-pressed', on );

} );

function goView( i, instant = false ) {

	const v = VIEWS[ i ];
	const to = { pos: new THREE.Vector3( ...v.pos ).add( focus ).setY( v.pos[ 1 ] ), target: new THREE.Vector3( ...v.target ).add( new THREE.Vector3( focus.x, 0, focus.z ) ) };
	narrowNow = narrowFor();
	to.pos.sub( to.target ).multiplyScalar( narrowNow ).add( to.target );

	// with reduced motion the camera jumps instead of flying
	if ( instant || reduceMotion.matches ) {

		camera.position.copy( to.pos ); controls.target.copy( to.target ); controls.update();
		snapFocus = true;

	} else {

		fly = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), ...to };

	}

	markViews( i );
	wake();

}

// ---------- Controls

const $ = ( s ) => document.querySelector( s );
const raycaster = new THREE.Raycaster();
let downAt = null, multi = false, focusGoal = null; // focusGoal in turntable coordinates
// true: blur strength follows the distance to focusGoal instead of the center stone (viewer.setFocus)
let focusScale = false;

canvas.addEventListener( 'pointerdown', e => {

	fly = null;
	if ( e.isPrimary ) { downAt = [ e.clientX, e.clientY ]; multi = false; } else multi = true;

} );
canvas.addEventListener( 'pointercancel', () => { downAt = null; } );
// Keyboard on the image: arrows rotate and tilt, plus and minus zoom
const _sph = new THREE.Spherical(), _off = new THREE.Vector3();
canvas.addEventListener( 'keydown', e => {

	const k = { ArrowLeft: [ - 1, 0, 1 ], ArrowRight: [ 1, 0, 1 ], ArrowUp: [ 0, - 1, 1 ], ArrowDown: [ 0, 1, 1 ], '+': [ 0, 0, 0.88 ], '=': [ 0, 0, 0.88 ], '-': [ 0, 0, 1.14 ] }[ e.key ];
	if ( ! k || e.altKey || e.ctrlKey || e.metaKey ) return;
	e.preventDefault();
	fly = null;
	_sph.setFromVector3( _off.copy( camera.position ).sub( controls.target ) );
	_sph.theta += k[ 0 ] * 0.15;
	_sph.phi = THREE.MathUtils.clamp( _sph.phi + k[ 1 ] * 0.1, 0.05, controls.maxPolarAngle );
	_sph.radius = THREE.MathUtils.clamp( _sph.radius * k[ 2 ], controls.minDistance, controls.maxDistance );
	camera.position.copy( controls.target ).add( _off.setFromSpherical( _sph ) );
	markViews( - 1 );

} );
canvas.addEventListener( 'wheel', () => { fly = null; }, { passive: true } );
canvas.addEventListener( 'pointerup', e => {

	const d = downAt;
	if ( e.isPrimary ) downAt = null;
	if ( ! e.isPrimary || multi || ! d || e.button !== 0 || Math.hypot( e.clientX - d[ 0 ], e.clientY - d[ 1 ] ) > 4 ) return;
	// Click without dragging: set the focus on the hit point
	const r = canvas.getBoundingClientRect();
	raycaster.setFromCamera( new THREE.Vector2( ( e.clientX - r.left ) / r.width * 2 - 1, - ( e.clientY - r.top ) / r.height * 2 + 1 ), camera );
	const hit = raycaster.intersectObject( turn, true )[ 0 ];
	if ( hit ) { focusGoal = turn.worldToLocal( hit.point.clone() ); focusScale = false; }

} );

document.querySelectorAll( '[data-view]' ).forEach( b => b.addEventListener( 'click', () => goView( Number( b.dataset.view ) ) ) );
document.querySelectorAll( '[data-q]' ).forEach( b => b.addEventListener( 'click', () => { autoQuality = false; if ( b.dataset.q === state.quality ) return; state.quality = b.dataset.q; setQuality(); syncUI(); } ) );
$( '#play' ).addEventListener( 'click', () => { state.play = ! state.play; syncUI(); } );
$( '#reset' ).addEventListener( 'click', () => { turn.rotation.y = 0; probeDirty = true; caustics.dirty = true; key.shadow.needsUpdate = true; focusGoal = null; goView( 0 ); } );
if ( ! document.fullscreenEnabled ) $( '#full' ).remove(); // iPhone has no fullscreen for pages
else $( '#full' ).addEventListener( 'click', () => ( document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen() ).catch( () => {} ) );
$( '#scene' ).addEventListener( 'click', () => { state.dark = ! state.dark; setScene(); syncUI(); } );
$( '#dof' ).addEventListener( 'click', () => { state.dof = ! state.dof; buildPipeline(); syncUI(); } );
for ( const id of [ 'light', 'quality', 'config' ] ) $( '#' + id ).addEventListener( 'click', () => {

	for ( const other of [ 'light', 'quality', 'config' ] ) $( '#' + other + '-panel' ).hidden = other !== id || ! $( '#' + other + '-panel' ).hidden;
	syncUI();

} );
$( '#az' ).addEventListener( 'input', e => { state.az = Number( e.target.value ); setLight(); syncUI(); } );
$( '#el' ).addEventListener( 'input', e => { state.el = Number( e.target.value ); setLight(); syncUI(); } );
$( '#env' ).addEventListener( 'input', e => { state.env = Number( e.target.value ); applyEnvRot(); } );

function chips( host, list, key ) {

	for ( const id in list ) {

		const b = document.createElement( 'button' );
		b.className = 'chip'; b.dataset.id = id;
		const dot = document.createElement( 'i' );
		dot.style.background = list[ id ].color;
		b.append( dot, list[ id ].name );
		b.addEventListener( 'click', () => { state[ key ] = id; setMaterials(); syncUI(); } );
		host.append( b );

	}

}

// Adjust the light directly in the image, visible while the light panel is open
const gizmo = new LightGizmo( {
	svg: $( '#gizmo' ), camera, controls, center: new THREE.Vector3( focus.x, 0, focus.z ),
	get: () => ( { az: state.az, el: state.el } ),
	set: ( az, el ) => {

		if ( az === state.az && el === state.el ) return;
		state.az = az; state.el = el;
		$( '#az' ).value = az; $( '#el' ).value = el;
		setLight(); syncUI();

	}
} );

// ---------- Custom models (GLB)

// Release the parts of a ring. The metal and the pooled stone materials belong to the viewer and stay.
function disposeRing( r ) {

	const used = new Set();

	r.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		o.geometry.dispose();
		for ( const m of [].concat( o.material ) ) used.add( m );

	} );

	const own = new Set( [ ...pool.values(), ...Object.values( finishes ) ] );

	for ( const m of used ) {

		if ( m === metal || own.has( m ) ) continue;
		m.probeRT?.dispose();
		standIns.get( m )?.dispose();
		standIns.delete( m );
		caustics.forget( m );
		m.dispose();

	}

}

// Switch ring, stones, probes, caustics, light and camera to a new ring.
// keep: rebuild in the ring editor, camera, turntable and stone choice stay.
function useModel( res, keep = false ) {

	turn.remove( ring );
	disposeRing( ring );
	ring = res.ring;
	gems = res.gems;
	layDown( ring );
	if ( ! keep ) turn.rotation.y = 0;
	turn.add( ring );
	const before = focus.clone();
	frameRing();

	// on rebuild the ring center moves: carry the camera along so the ring stays in place in the image
	if ( keep ) {

		const d = focus.clone().sub( before );
		camera.position.add( d );
		controls.target.add( d );
		controls.update();

	}
	key.target.position.copy( focus ).setY( 0 );
	caustics.center.value.copy( focus ).setY( 0 );
	gizmo.center.set( focus.x, 0, focus.z );
	setupProbes();
	attachCaustics();

	// Take stone types from the model into the selection
	if ( ! keep ) {

		const kind = ( group ) => gems.find( g => g.group === group )?.mesh.material.stone?.id;
		state.center = kind( 'center' ) || 'lab-diamond';
		state.side = kind( 'side' ) || state.side;

	}

	setMaterials();
	setLight();
	if ( ! keep ) {

		focusGoal = null;
		goView( 0, true );

	}

	syncUI();

}

// Rebuild the ring from the design (ring editor)
function applyDesign() {

	useModel( designRing(), true );
	$( '#model-info' ).replaceChildren();
	$( '#sample' ).hidden = true;

}

// Loads a GLB from a file or from an address in the models/ folder
async function loadFile( src, label ) {

	const info = $( '#model-info' );
	info.replaceChildren( 'Loading ' + label );

	try {

		const { loadModel, orientModel, describeModel } = await import( './model.js' );
		const data = typeof src === 'string' ? src : await src.arrayBuffer();
		// GLB starts with "glTF"; otherwise the message would be a JSON error from the loader
		if ( typeof data !== 'string' && ( data.byteLength < 12 || String.fromCharCode( ...new Uint8Array( data, 0, 4 ) ) !== 'glTF' ) ) throw new Error( 'not a GLB file' );
		const res = orientModel( await loadModel( data, { metal } ), REF_WIDTH );
		useModel( res );
		info.replaceChildren( label + ': ' + describeModel( res ) );

		if ( res.warnings.length ) {

			const ul = document.createElement( 'ul' );
			for ( const w of res.warnings.slice( 0, 6 ) ) ul.append( Object.assign( document.createElement( 'li' ), { textContent: w } ) );
			if ( res.warnings.length > 6 ) ul.append( Object.assign( document.createElement( 'li' ), { textContent: 'and ' + ( res.warnings.length - 6 ) + ' more' } ) );
			info.append( ul );

		}

		$( '#sample' ).hidden = false;

	} catch ( e ) {

		console.error( 'Model not loaded:', e );
		info.replaceChildren( 'Could not load ' + label + ': ' + ( e?.message || e ) );

	}

}

const fileInput = $( '#file' );
$( '#load' ).addEventListener( 'click', () => fileInput.click() );
fileInput.addEventListener( 'change', () => {

	const f = fileInput.files[ 0 ];
	if ( f ) loadFile( f, f.name );
	fileInput.value = '';

} );
$( '#sample' ).addEventListener( 'click', () => {

	useModel( designRing() );
	$( '#model-info' ).replaceChildren();
	$( '#sample' ).hidden = true;

} );

// Drag a file onto the window: open the material panel so the result is visible
window.addEventListener( 'dragover', ( e ) => { if ( e.dataTransfer?.types.includes( 'Files' ) ) e.preventDefault(); } );
window.addEventListener( 'drop', ( e ) => {

	const f = [ ...( e.dataTransfer?.files || [] ) ].find( x => /\.glb$/i.test( x.name ) );
	if ( ! e.dataTransfer?.files.length ) return;
	e.preventDefault();

	if ( ! f ) {

		$( '#model-info' ).replaceChildren( 'Only GLB files (.glb) can be loaded.' );

	} else loadFile( f, f.name );

	for ( const id of [ 'light', 'quality', 'config' ] ) $( '#' + id + '-panel' ).hidden = id !== 'config';
	syncUI();

} );

chips( $( '#metals' ), METALS, 'metal' );

// ---------- Ring editor

const design = () => state.design;
const num = ( v, digits ) => v.toLocaleString( 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false } );
let gemTarget = 'center';

// Rebuild at most once per frame, even if a slider sends many events
let rebuildQueued = false;
function rebuild() {

	if ( rebuildQueued ) return;
	rebuildQueued = true;
	requestAnimationFrame( () => { rebuildQueued = false; applyDesign(); } );

}

// Picker buttons: items [{ id, name, color }], get returns the active id
const pickers = [];
function picker( host, items, get, set ) {

	for ( const it of items ) {

		const b = document.createElement( 'button' );
		b.className = 'chip'; b.dataset.id = it.id;
		if ( it.color ) { const dot = document.createElement( 'i' ); dot.style.background = it.color; b.append( dot ); }
		b.append( it.name );
		b.addEventListener( 'click', () => { set( it.id ); syncUI(); } );
		host.append( b );

	}

	pickers.push( { host, get } );

}

// Slider with readout: fmt formats the value for display
const sliders = [];
function slider( id, [ min, max ], get, set, fmt ) {

	const input = $( '#' + id ), out = $( '#' + id + '-out' );
	input.min = min; input.max = max;
	input.addEventListener( 'input', () => { set( Number( input.value ) ); out.textContent = fmt( Number( input.value ) ); input.setAttribute( 'aria-valuetext', out.textContent ); rebuild(); } );
	sliders.push( { input, out, get, fmt } );

}

const named = ( obj ) => Object.entries( obj ).map( ( [ id, v ] ) => ( { id, name: v.name } ) );
const list = ( ids, names ) => ids.map( ( id, i ) => ( { id, name: names[ i ] } ) );

picker( $( '#styles' ), STYLES, () => design().style, ( id ) => {

	// a different style brings its own band and pavé
	Object.assign( design(), { style: id }, styleDefaults( id ) );
	rebuild();

} );
picker( $( '#profiles' ), named( PROFILES ), () => design().profile, ( id ) => { design().profile = id; rebuild(); } );
picker( $( '#cuts' ), CUTS, () => design().cut, ( id ) => { design().cut = id; rebuild(); } );

// Stones: center stone or accent stones, quick picks and library with search
$( '#gem-target' ).querySelectorAll( 'button' ).forEach( b => b.addEventListener( 'click', () => { gemTarget = b.dataset.target; syncUI(); } ) );

function chooseGem( id ) {

	if ( gemTarget === 'center' ) {

		// The weight applies to the stone type: a different density changes the size
		const densityDiffers = STONE_BY_ID[ state.center ].rho !== STONE_BY_ID[ id ].rho;
		state.center = id;
		if ( densityDiffers ) rebuild();

	} else state.side = id;

	setMaterials();
	syncUI();

}

const QUICK = [ 'natural-diamond', 'lab-diamond', 'ruby', 'blue-sapphire', 'emerald', 'aquamarine', 'morganite', 'amethyst' ].filter( id => STONE_BY_ID[ id ] );
picker( $( '#quick-gems' ), QUICK.map( id => ( { id, name: STONE_BY_ID[ id ].name, color: STONE_BY_ID[ id ].color } ) ), () => gemTarget === 'center' ? state.center : state.side, chooseGem );

function gemList() {

	const q = $( '#gem-search' ).value.trim().toLowerCase();
	const host = $( '#gem-list' ), active = gemTarget === 'center' ? state.center : state.side;
	host.replaceChildren();

	for ( const s of GEMSTONES ) {

		if ( q && ! ( s.name + ' ' + s.family ).toLowerCase().includes( q ) ) continue;
		const b = document.createElement( 'button' );
		const dot = document.createElement( 'i' );
		dot.style.background = s.color;
		const text = document.createElement( 'span' );
		text.append( s.name, Object.assign( document.createElement( 'small' ), { textContent: s.family } ) );
		b.append( dot, text );
		b.classList.toggle( 'on', s.id === active );
		b.setAttribute( 'aria-pressed', s.id === active );
		b.addEventListener( 'click', () => chooseGem( s.id ) );
		host.append( b );

	}

}

$( '#gem-search' ).addEventListener( 'input', gemList );

slider( 'carat', CARAT_RANGE, () => design().carat, ( v ) => { design().carat = v; }, ( v ) => num( v, 2 ) + ' ct' );

// Edit band
const mm = ( v ) => num( v, 2 ) + ' mm';
picker( $( '#band-shape' ), list( BAND_CHOICES.shape, [ 'Round', 'Flat', 'Domed', 'Knife edge' ] ), () => design().band.shape, ( id ) => { design().band.shape = id; rebuild(); } );
picker( $( '#band-shoulders' ), list( BAND_CHOICES.shoulders, [ 'Straight', 'Tapered', 'Flared', 'Split' ] ), () => design().band.shoulders, ( id ) => { design().band.shoulders = id; rebuild(); } );
picker( $( '#band-finish' ), list( BAND_CHOICES.finish, [ 'Polished', 'Brushed', 'Hammered' ] ), () => design().band.finish, ( id ) => { design().band.finish = id; rebuild(); } );
picker( $( '#band-edge' ), list( BAND_CHOICES.edge, [ 'Plain', 'Bevel', 'Milgrain' ] ), () => design().band.edge, ( id ) => { design().band.edge = id; rebuild(); } );
slider( 'band-width', BAND_RANGES.width, () => design().band.width, ( v ) => { design().band.width = v; }, mm );
slider( 'band-thickness', BAND_RANGES.thickness, () => design().band.thickness, ( v ) => { design().band.thickness = v; }, mm );
slider( 'band-front', BAND_RANGES.front, () => design().band.front, ( v ) => { design().band.front = v; }, mm );
picker( $( '#pave-rows' ), list( [ 1, 2, 3 ], [ 'One row', 'Two rows', 'Three rows' ] ), () => design().pave.rows, ( id ) => { design().pave.rows = id; rebuild(); } );
picker( $( '#pave-sizing' ), list( [ 'graduated', 'fixed' ], [ 'Graduated', 'Equal size' ] ), () => design().pave.sizing, ( id ) => { design().pave.sizing = id; rebuild(); } );
slider( 'pave-count', PAVE_RANGES.count, () => design().pave.count, ( v ) => { design().pave.count = v; }, ( v ) => String( v ) );
slider( 'pave-weight', PAVE_RANGES.weight, () => design().pave.weight, ( v ) => { design().pave.weight = v; }, ( v ) => num( v, 3 ) + ' ct' );
slider( 'pave-pitch', PAVE_RANGES.pitch, () => design().pave.pitch, ( v ) => { design().pave.pitch = v; }, mm );
$( '#band-reset' ).addEventListener( 'click', () => { Object.assign( design(), styleDefaults( design().style ) ); rebuild(); syncUI(); } );

// With the panel open the image shifts right into the free space (camera film offset:
// TRAA sets the image offset itself and would overwrite a custom one)
function panelShift() {

	const shift = panelRight() / 2;
	// Offset of the image window: fraction of the image width times the width of the field of view per distance
	const w = canvas.clientWidth || 1;
	const offset = - shift / w * camera.aspect * 2 * Math.tan( camera.fov * Math.PI / 360 ) * camera.getFilmWidth();
	if ( Math.abs( offset - camera.filmOffset ) < 1e-9 ) return;
	camera.filmOffset = offset;
	camera.updateProjectionMatrix();
	wake();

}

function syncUI() {

	const mark = ( b, on ) => { b.classList.toggle( 'on', on ); b.setAttribute( 'aria-pressed', on ); };
	document.querySelectorAll( '[data-q]' ).forEach( b => mark( b, b.dataset.q === state.quality ) );
	mark( $( '#play' ), state.play );
	mark( $( '#dof' ), state.dof );
	mark( $( '#scene' ), state.dark );
	for ( const id of [ 'light', 'quality', 'config' ] ) $( '#' + id ).setAttribute( 'aria-expanded', ! $( '#' + id + '-panel' ).hidden );
	gizmo.show( ! $( '#light-panel' ).hidden );
	$( '#azv' ).textContent = state.az + '°';
	$( '#elv' ).textContent = state.el + '°';
	$( '#az' ).setAttribute( 'aria-valuetext', state.az + ' degrees' );
	$( '#el' ).setAttribute( 'aria-valuetext', state.el + ' degrees' );
	$( '#metals' ).querySelectorAll( '.chip' ).forEach( b => mark( b, b.dataset.id === state.metal ) );
	for ( const p of pickers ) p.host.querySelectorAll( '.chip' ).forEach( b => mark( b, b.dataset.id === String( p.get() ) ) );
	$( '#gem-target' ).querySelectorAll( 'button' ).forEach( b => mark( b, b.dataset.target === gemTarget ) );
	for ( const s of sliders ) {

		const v = s.get();
		if ( document.activeElement !== s.input ) s.input.value = v;
		s.out.textContent = s.fmt( v );
		s.input.setAttribute( 'aria-valuetext', s.out.textContent );

	}

	if ( ! $( '#config-panel' ).hidden ) gemList();
	document.body.classList.toggle( 'designing', ! $( '#config-panel' ).hidden );
	panelShift();
	refit();
	wake(); // the gizmo needs a new frame too

}

window.addEventListener( 'resize', resize );
window.addEventListener( 'keydown', e => {

	if ( e.key !== 'Escape' ) return;

	for ( const id of [ 'light', 'quality', 'config' ] ) {

		const panel = $( '#' + id + '-panel' );
		// Return focus to the button that opened the panel
		if ( ! panel.hidden && panel.contains( document.activeElement ) ) $( '#' + id ).focus();
		panel.hidden = true;

	}

	syncUI();

} );
// after free rotation none of the fixed views is active
controls.addEventListener( 'start', () => markViews( - 1 ) );
// Browser zoom or another monitor: follow the pixel ratio
const watchRatio = () => matchMedia( '(resolution: ' + window.devicePixelRatio + 'dppx)' ).addEventListener( 'change', () => { resize(); watchRatio(); }, { once: true } );
watchRatio();

// ---------- Start

setScene();
setMaterials();
setLight();
setQuality();
goView( 0, true );
syncUI();
status.textContent = isWebGPU ? 'WebGPU' : 'WebGL 2';
// ?model=models/name.glb loads a model from the project folder (only this folder, only .glb)
const startModel = params.get( 'model' );
if ( startModel && /^models\/[\w.-]+\.glb$/i.test( startModel ) ) loadFile( startModel, startModel.slice( 7 ) );

const timer = new THREE.Timer();
const _fp = new THREE.Vector3(), _fwd = new THREE.Vector3(), _sp = new THREE.Vector3(), _buf = new THREE.Vector2();
// Reference for focus and blur is the center stone, or the ring center for a model without a detected stone
const pivot = ( v ) => gems.length ? gems[ 0 ].mesh.getWorldPosition( v ) : v.copy( focus );
// Blur per camera distance: overview almost sharp (back of the band about 0.2 % of the
// image width), middle clear (about 1 %), macro very soft (about 2 %). Towards macro the image
// gets soft faster than with a fixed-aperture lens, hence the power 2.25. Capped at 4 % of the
// image width, above that the blur falls apart.
const LENS = 0.48, LENS_POW = 2.25, LENS_MAX = 0.04;
let tick = 0;

// Measure the frame rate and step down one level if needed. Only without a fixed choice (address
// or button), only over drawn frames, without the settle time after a rebuild and without pauses.
let perf = [];

function measure( raw ) {

	if ( ! autoQuality || frames < settleUntil || raw > 0.25 || state.quality === 'low' ) return;
	perf.push( raw );
	if ( perf.length < 90 ) return;
	perf.sort( ( a, b ) => a - b );
	const median = perf[ 45 ];
	perf = [];
	if ( median < 1 / 24 ) return;
	state.quality = state.quality === 'high' ? 'mid' : 'low';
	console.info( 'Facette: frame time ' + Math.round( median * 1000 ) + ' ms, quality now ' + state.quality );
	setQuality();
	syncUI();

}

// ?fps shows frame time and quality level, for measuring on real devices
const fpsBox = params.has( 'fps' ) ? document.getElementById( 'fps' ) : null;
if ( fpsBox ) fpsBox.hidden = false;
let fpsTimes = [];

function showFps( raw ) {

	if ( raw > 0.25 ) return;
	fpsTimes.push( raw );
	if ( fpsTimes.length < 30 ) return;
	fpsTimes.sort( ( a, b ) => a - b );
	const ms = fpsTimes[ 15 ] * 1000;
	fpsTimes = [];
	const b = renderer.getDrawingBufferSize( _buf );
	fpsBox.textContent = `${ ms.toFixed( 1 ) } ms  ${ Math.round( 1000 / ms ) } fps
${ state.quality }  ${ isWebGPU ? 'WebGPU' : 'WebGL 2' }  ${ b.x }×${ b.y }`;

}

renderer.setAnimationLoop( frame );

function frame() {

	// An error during shader build would otherwise throw again on every frame
	try {

		step();

	} catch ( e ) {

		renderer.setAnimationLoop( null );
		console.error( 'Facette stopped:', e );
		notify( 'An error occurred while drawing. Please reload the page.' );

	}

}

function step() {

	timer.update();
	const raw = timer.getDelta();
	const dt = Math.min( raw, 0.05 );
	tick ++;

	if ( state.play ) {

		turn.rotation.y += dt * 0.35;
		// Shadow, caustics and probe only every second frame: one frame of lag is not noticeable
		if ( tick % 2 === 0 ) { caustics.dirty = true; key.shadow.needsUpdate = true; probeDirty = true; }

	}

	if ( fly ) {

		fly.t = Math.min( 1, fly.t + dt / 1.1 );
		const k = fly.t * fly.t * ( 3 - 2 * fly.t );
		camera.position.lerpVectors( fly.fromPos, fly.pos, k );
		controls.target.lerpVectors( fly.fromTarget, fly.target, k );
		if ( fly.t >= 1 ) fly = null;

	}

	let moving = controls.update() || fly !== null || state.play;
	turn.updateMatrixWorld( true );

	// Focus plane: clicked point, otherwise the pivot
	if ( focusGoal ) turn.localToWorld( _fp.copy( focusGoal ) ); else pivot( _fp );
	const want = _fp.sub( camera.position ).dot( camera.getWorldDirection( _fwd ) );
	const step = want - focusDist.value;
	focusDist.value += step * ( snapFocus ? 1 : Math.min( 1, dt * 6 ) );
	snapFocus = false;
	if ( Math.abs( step ) > 1e-3 ) moving = true;
	// Strength and focus range depend on the setup, that is on the camera distance to the
	// center stone, not on the focus point: a click on the back of the band only moves the
	// focus, and the stone in front then gets as soft as the back of the band otherwise. The
	// radius is in buffer pixels, so scale it with the buffer width.
	const ref = focusGoal && focusScale ? turn.localToWorld( _sp.copy( focusGoal ) ) : pivot( _sp );
	const zs = Math.max( ref.sub( camera.position ).dot( _fwd ), 0.5 );
	const W = renderer.getDrawingBufferSize( _buf ).x;
	focusRange.value = zs * 1.25;
	bokeh.value = W * Math.min( LENS / Math.pow( zs, LENS_POW ), LENS_MAX );

	// Standstill: after the temporal filters (TRAA, AO) have settled nothing is drawn any more
	// and the image stays. Saves battery and heat on phones.
	const probeBusy = state.play || performance.now() < probeBusyUntil;
	if ( ! probeBusy && sidesStale ) probeDirty = true;
	if ( moving || probeDirty || caustics.dirty || key.shadow.needsUpdate ) still = 0;
	if ( still > 45 ) return;
	// Motion: depth of field does not average over old frames, otherwise it lags
	if ( still === 0 && lens ) lens.restart();
	still ++;

	caustics.update();
	if ( probeDirty ) updateProbes( ! probeBusy || ++ probeTick % 3 === 0 );
	pipeline.render();
	if ( gizmo.visible ) gizmo.update();
	frames ++;
	if ( frames === 3 ) document.body.classList.add( 'ready' );
	measure( raw );
	if ( fpsBox ) showFps( raw );

}

// for external checks
window.viewer = { u: { groundColor, shadowStrength, reflGain, causticTint, bgColor, focusDist, focusRange, bokeh, metalWarm, grade }, key, grounds, shared, state, renderer, scene, camera, controls, caustics, gizmo, updateProbes, get probes() { return probes; }, get gems() { return gems; }, get ring() { return ring; }, useModel, loadFile, probeRT, probeDark, markProbe: () => { probeDirty = true; }, setScene, setLight, setQuality, setMaterials, goView, buildPipeline, syncUI, isWebGPU, get frames() { return frames; }, get lens() { return lens; }, measure, notify,
	// Ring editor: set the design (without a camera jump) and the default design
	defaultDesign: DEFAULT_DESIGN, pool,
	setDesign: ( d ) => { state.design = structuredClone( d ); applyDesign(); },
	// Set the focus for captures: point in world coordinates, null = center stone. The focus
	// jumps without easing, the strength follows the distance to this point.
	setFocus: ( p ) => { focusGoal = p ? turn.worldToLocal( p.clone() ) : null; focusScale = !! p; snapFocus = true; wake(); } };
