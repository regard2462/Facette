// SPDX-License-Identifier: AGPL-3.0-or-later
// Procedural photo studio: room, softboxes and black flags from simple surfaces,
// rendered once into an HDR cube texture.
// Polished metal is a mirror and shows the studio almost unchanged. It needs large, softly
// fading light surfaces and black cards, otherwise it looks grey and flat.
// The small spark lights exist only in the version for the stones.
import {
	Scene, Mesh, SphereGeometry, PlaneGeometry, MeshBasicNodeMaterial, BackSide, DoubleSide,
	CubeCamera, CubeRenderTarget, HalfFloatType, LinearMipmapLinearFilter, Float32BufferAttribute
} from 'three';
import { vec3, float, positionLocal, normalize, smoothstep, mix, uv, atan, abs, attribute } from 'three/tsl';

// Surface in direction az/el (degrees). soft is the fraction of the edge that fades out,
// separately for width and height; a long strip with a soft edge gives flowing gradients in metal.
let gain = 1; // brightness of the light surfaces, higher for the stone version

// All light surfaces share one material, strength, softness and colour sit in the corners
// of the surface. This avoids one shader per surface.
const boxParams = attribute( 'boxParams', 'vec3' ); // strength, softness width, softness height
const boxTint = attribute( 'boxTint', 'vec3' );
const boxMaterial = new MeshBasicNodeMaterial( { side: DoubleSide } );
{

	const d = uv().sub( 0.5 ).abs().mul( 2 );
	const edge = smoothstep( boxParams.y.oneMinus(), 1, d.x ).oneMinus().mul( smoothstep( boxParams.z.oneMinus(), 1, d.y ).oneMinus() );
	// slightly domed brightness like a real softbox: center brighter than the edge
	const dome = mix( float( 0.75 ), float( 1 ), d.x.mul( d.x ).oneMinus() );
	boxMaterial.colorNode = boxTint.mul( boxParams.x ).mul( edge ).mul( dome );

}

function box( scene, az, el, dist, w, h, intensity, tint = [ 1, 1, 1 ], soft = 0.25, softH = soft ) {

	if ( intensity > 0.01 ) intensity *= gain;

	const g = new PlaneGeometry( w, h );
	g.setAttribute( 'boxParams', new Float32BufferAttribute( Array( 4 ).fill( [ intensity, soft, softH ] ).flat(), 3 ) );
	g.setAttribute( 'boxTint', new Float32BufferAttribute( Array( 4 ).fill( tint ).flat(), 3 ) );
	const mesh = new Mesh( g, boxMaterial );
	const a = az * Math.PI / 180, e = el * Math.PI / 180;
	mesh.position.set( Math.sin( a ) * Math.cos( e ), Math.sin( e ), Math.cos( a ) * Math.cos( e ) ).multiplyScalar( dist );
	mesh.lookAt( 0, 0, 0 );
	scene.add( mesh );
	return mesh;

}

// black card (flag)
const flag = ( scene, az, el, w, h ) => box( scene, az, el, 9, w, h, 0.003, [ 1, 1, 1 ], 0.12 );

export function buildStudio( renderer, { dark = false, sparks = false, size = 512, lights = 1 } = {} ) {

	gain = lights;

	const scene = new Scene();

	const room = new MeshBasicNodeMaterial( { side: BackSide } );
	const dir = normalize( positionLocal );
	const y = dir.y;

	if ( dark ) {

		// Polished metal shows only what it reflects. As in a product photo on black, a few large
		// softboxes surround the ring and the room between them is black: gold shows warm
		// highlights that run in long gradients into deep shadows. A faint grey base tone
		// would turn gold olive grey. bgColor draws the visible background.
		room.colorNode = mix( vec3( 0.002, 0.0015, 0.001 ), vec3( 0.006, 0.005, 0.0035 ), smoothstep( - 0.3, 1, y ) );

	} else {

		// Light tent: bright above, bright table, a narrow dark edge at the horizon.
		// The edge draws the clear dark line in the metal that makes polished platinum.
		const sky = mix( float( 0.55 ), float( 1.05 ), smoothstep( 0.02, 0.85, y ) );
		// smoothstep only with ascending bounds, swapped ones are undefined in GLSL and WGSL
		const floor = mix( float( 0.62 ), float( 0.78 ), smoothstep( - 1, - 0.05, y ) );
		const base = mix( floor, sky, smoothstep( - 0.01, 0.01, y ) );
		const horizon = smoothstep( 0.015, 0.09, abs( y ) );
		// toward the back the tent gets slightly darker: gives the side surfaces a gradient
		const az = atan( dir.x, dir.z );
		const back = smoothstep( 0.6, 3.1, abs( az ) ).mul( 0.25 ).oneMinus();
		room.colorNode = vec3( mix( float( 0.06 ), base.mul( back ), horizon ) );

	}

	scene.add( new Mesh( new SphereGeometry( 40, 96, 48 ), room ) );

	if ( dark ) {

		const W = [ 1, 0.98, 0.95 ]; // barely warm: gold gets warmth, platinum stays neutral
		// A few large softboxes that fade out softly from center to edge: in gold they give long
		// gradients from bright highlights into black. The room between them stays black, so
		// band and prongs keep deep shadows.
		box( scene, 40, 45, 12, 9, 13, 6, W, 1, 1 );
		box( scene, - 75, 28, 12, 8, 10, 3, W, 1, 1 );
		box( scene, 160, 25, 12, 16, 6, 3.5, W, 1, 1 );
		box( scene, 0, 78, 12, 14, 12, 2.5, W, 1, 1 );
		// two wide surfaces just above the horizon: at a flat view the flanks of the band mirror
		// these directions, without them the band would look only dark on the turntable
		box( scene, - 125, 14, 12, 14, 6, 4, W, 1, 1 );
		box( scene, 60, 12, 12, 10, 5, 3, W, 1, 1 );
		// faint back reflection of the glossy black table top
		box( scene, 20, - 35, 12, 18, 9, 0.03, W, 1, 1 );

	} else {

		box( scene, 40, 52, 12, 7, 7, 2.6, [ 1, 1, 1 ], 0.45 );
		box( scene, - 65, 28, 12, 3.2, 9, 2.0, [ 1, 1, 1 ], 0.6, 0.3 );
		box( scene, 165, 32, 12, 11, 1.8, 2.4, [ 1, 1, 1 ], 0.3, 0.7 );
		box( scene, 0, 88, 12, 6, 6, 1.6, [ 1, 1, 1 ], 0.6 );
		// narrow, tall cards give the stones dark edges. In metal they would appear as black
		// spots, there the dark horizon edge does the drawing.
		if ( sparks ) {

			flag( scene, 98, 18, 1.4, 7 );
			flag( scene, - 125, 18, 1.8, 7 );
			flag( scene, - 15, 12, 1.0, 4 );
			flag( scene, 200, 14, 1.6, 6 );

		}

	}

	// small hard lights for sparks in the stone
	if ( sparks ) {

		const pts = [ [ 20, 35 ], [ - 30, 60 ], [ 80, 45 ], [ 130, 60 ], [ - 110, 40 ], [ - 160, 55 ], [ 60, 75 ], [ - 80, 70 ], [ 10, 20 ], [ - 45, 15 ], [ 150, 18 ], [ 95, 28 ] ];
		gain = 1;
		for ( const [ az, el ] of pts ) box( scene, az, el, 11, 0.5, 0.5, dark ? 70 : 45, [ 1, 1, 1 ], 0.6 );

	}

	const rt = new CubeRenderTarget( size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter } );
	const cam = new CubeCamera( 0.1, 100, rt );
	cam.update( renderer, scene );

	// the shared material is kept for the next version
	scene.traverse( o => { if ( o.isMesh ) { o.geometry.dispose(); if ( o.material !== boxMaterial ) o.material.dispose(); } } );

	return rt;

}
