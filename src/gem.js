// SPDX-License-Identifier: AGPL-3.0-or-later
// Gemstone material: the view ray is traced in the fragment shader against the real facet
// planes of the stone (refraction in, total internal reflections, exit with Fresnel and a
// separate refractive index per colour channel). No textures, no path tracing: a fixed number
// of bounces per pixel, evaluated in a single raster pass.
import { MeshBasicNodeMaterial, Vector3, Vector4, Color } from 'three';
import {
	Fn, Loop, If, Break, vec3, vec4, float, int, uniform, uniformArray, cubeTexture,
	positionGeometry, normalGeometry, positionWorld, cameraPosition, modelWorldMatrix, modelWorldMatrixInverse,
	dot, max, min, normalize, refract, reflect, exp, pow, mix, smoothstep, length, cos, sin, clamp
} from 'three/tsl';
import { MAX_PLANES } from './gemcut.js';
import { GEMSTONES } from './library.js';

// All stones of the library by id
export const STONE_BY_ID = Object.fromEntries( GEMSTONES.map( s => [ s.id, s ] ) );

// Short names for loaded models (stone kind from material and object names)
export const STONES = {
	diamond: STONE_BY_ID[ 'lab-diamond' ],
	sapphire: STONE_BY_ID[ 'blue-sapphire' ],
	ruby: STONE_BY_ID.ruby,
	emerald: STONE_BY_ID.emerald,
	aquamarine: STONE_BY_ID.aquamarine,
	morganite: STONE_BY_ID.morganite
};

// Millimetres per Facette unit
const MM_PER_UNIT = 8.92;

// Uniforms shared by the whole scene (light, environment, quality)
export const shared = {
	head: uniform( 0.8 ), // how strongly the viewer shades the light from their direction
	envGain: uniform( 1 ),
	contrast: uniform( 1.5 ),
	fire: uniform( 0.55 ), // strength of dispersion, 1 = physical (disp is the full spread red to blue)
	lightDir: uniform( new Vector4( 0.4, 0.8, 0.4, 0 ) ), // toward the light source, world
	lightGain: uniform( 60 ),
	bounces: uniform( 6, 'int' ),
	envTex: null
};

// The viewer stands in the room and blocks the light from their direction.
// This gives the stones the dark facets that their contrast depends on.
const headShade = ( dirW, eyeW ) => smoothstep( 0.86, 0.975, dot( dirW, eyeW ) ).mul( shared.head ).oneMinus();

// Environment in a world direction from the probe at the center stone (studio, metal, floor),
// plus a sharp light spot of the main lamp (gives the sparkle).
// The mip level is always set explicitly: implicit derivatives would be undefined inside
// loops and branches and jump at facet edges.
// tex is the probe the stone sees (own probe per stone group or the shared one)
export const envRadiance = ( tex, dirW, eyeW, lod ) => {

	// Contrast curve: stones live on the alternation of bright and dark facets
	const e = pow( cubeTexture( tex, dirW, lod ).rgb, vec3( shared.contrast ) ).mul( shared.envGain );
	return e.add( vec3( lightSpot( dirW ) ) ).mul( headShade( dirW, eyeW ) );

};

const lightSpot = ( dirW ) => pow( max( dot( dirW, shared.lightDir.xyz ), 0 ), 900 ).mul( shared.lightGain );

// a single colour channel, saves two of three powers
const envChannel = ( tex, dirW, eyeW, ch ) => pow( cubeTexture( tex, dirW, float( 0.35 ) )[ ch ], shared.contrast ).mul( shared.envGain ).add( lightSpot( dirW ) ).mul( headShade( dirW, eyeW ) );

// Exit from the convex stone from inside: nearest plane along the ray direction
export function exitConvex( planes, count, o, d, tOut, nOut ) {

	tOut.assign( 1e9 );

	Loop( { start: int( 0 ), end: count, type: 'int' }, ( { i } ) => {

		const p = planes.element( i );
		const dn = dot( p.xyz, d );

		const num = p.w.sub( dot( p.xyz, o ) );

		// Comparison without division, divide only for real candidates
		If( dn.greaterThan( 1e-5 ).and( num.lessThan( tOut.mul( dn ) ) ), () => {

			tOut.assign( num.div( dn ) );
			nOut.assign( p.xyz );

		} );

	} );

	tOut.assign( max( tOut, 0 ) );

}

// Absorption per cut unit: the library gives it per millimetre, one cut unit is as long as
// the scale of the stone in the world
export const absorbPerUnit = ( absorb ) => absorb.mul( length( modelWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz ).mul( MM_PER_UNIT ) );

export function schlick( cosT, f0 ) {

	return f0.add( f0.oneMinus().mul( pow( clamp( cosT.oneMinus(), 0, 1 ), 5 ) ) );

}

export class GemMaterial extends MeshBasicNodeMaterial {

	constructor( cut, stone = STONES.diamond ) {

		super();

		const arr = [];
		for ( let i = 0; i < MAX_PLANES; i ++ ) arr.push( new Vector4() );

		this.planes = uniformArray( arr, 'vec4' );
		this.planeCount = uniform( 0, 'int' );
		this.radius = uniform( 1 ); // bounding radius of the cut, for the caustics
		this.setCut( cut );
		this.stone = stone;
		this.ior = uniform( stone.ior );
		this.disp = uniform( stone.disp );
		this.tint = uniform( new Color( stone.color ) ); // colour of the substitute surface in the probes
		this.absorb = uniform( new Vector3( ...stone.absorb.map( a => Math.max( a, 0 ) ) ) );
		this.setting = uniform( new Color( 0.8, 0.8, 0.8 ) ); // colour of the setting under the stone
		// own probe of this stone; the shared one if unset (read only when the shader is built)
		this.envTex = null;
		this.lights = false;
		const env = () => this.envTex || shared.envTex;

		const { planes, planeCount, ior, disp, absorb } = this;

		const toWorld = ( d ) => normalize( modelWorldMatrix.mul( vec4( d, 0 ) ).xyz );

		this.colorNode = Fn( () => {

			const o = positionGeometry.toVar();
			const n = normalize( normalGeometry ).toVar();
			const camL = modelWorldMatrixInverse.mul( vec4( cameraPosition, 1 ) ).xyz;
			const v = normalize( o.sub( camL ) ).toVar();
			const eyeW = normalize( cameraPosition.sub( positionWorld ) ).toVar();

			const f0 = pow( ior.sub( 1 ).div( ior.add( 1 ) ), 2 );
			const cosI = max( dot( v.negate(), n ), 0 );
			const fr = schlick( cosI, f0 );

			// Reflection at the surface
			const col = envRadiance( env(), toWorld( reflect( v, n ) ), eyeW, float( 0 ) ).mul( fr ).toVar();

			// refraction into the stone
			const d = refract( v, n, float( 1 ).div( ior ) ).toVar();
			const thr = vec3( fr.oneMinus() ).toVar();
			const path = float( 0 ).toVar();
			const t = float( 0 ).toVar();
			const nh = vec3( 0, 1, 0 ).toVar();
			const dsp = disp.mul( shared.fire ).mul( 0.5 );
			const iors = vec3( ior.sub( dsp ), ior, ior.add( dsp ) );

			// Absorption per unit length. The path is measured in cut units and grows with the
			// size of the stone: small stones are paler.
			const sigma = absorbPerUnit( absorb );

			// Setting and band are part of the probe, no separate tint is needed
			const seen = ( dirL, ch ) => envChannel( env(), toWorld( dirL ), eyeW, ch );

			Loop( { start: int( 0 ), end: shared.bounces, type: 'int' }, () => {

				exitConvex( planes, planeCount, o, d, t, nh );
				o.addAssign( d.mul( t ) );
				path.addAssign( t );

				const att = exp( sigma.mul( path ).negate() );
				const out = vec3( 0 ).toVar();
				const refl = vec3( 1 ).toVar();

				// own refractive index per colour channel: dispersion (fire)
				for ( let c = 0; c < 3; c ++ ) {

					const ch = 'xyz'[ c ];
					const r = refract( d, nh.negate(), iors[ ch ] );

					If( dot( r, r ).greaterThan( 1e-4 ), () => {

						const F = schlick( dot( r, nh ), f0 );
						out[ ch ].assign( F.oneMinus().mul( seen( r, ch ) ) );
						refl[ ch ].assign( F );

					} );

				}

				col.addAssign( thr.mul( att ).mul( out ) );
				thr.mulAssign( refl );
				d.assign( reflect( d, nh ) );
				// move slightly inward so the plane just hit does not count again
				o.addAssign( nh.mul( - 1e-4 ) );

				// almost no energy left in the stone: stop
				If( max( thr.x, max( thr.y, thr.z ) ).lessThan( 0.01 ), () => { Break(); } );

			} );

			// Remainder still inside the stone after the bounces: one last exit with refraction,
			// sampled blurred. With total reflection the inner direction stays.
			exitConvex( planes, planeCount, o, d, t, nh );
			path.addAssign( t );
			const rG = refract( d, nh.negate(), ior ).toVar();
			If( dot( rG, rG ).lessThan( 1e-4 ), () => { rG.assign( d ); } );
			const rest = envRadiance( env(), toWorld( rG ), eyeW, float( 3 ) );
			col.addAssign( thr.mul( exp( sigma.mul( path ).negate() ) ).mul( rest ) );

			// Limit highlights so the bloom does not blow out
			return vec4( min( col, vec3( 7 ) ), 1 );

		} )();

	}

	setStone( stone ) {

		this.ior.value = stone.ior;
		this.disp.value = stone.disp;
		this.tint.value.set( stone.color );
		this.absorb.value.set( ...stone.absorb.map( a => Math.max( a, 0 ) ) );
		this.stone = stone;

	}

	// Switch the cut without a new shader: the planes sit in a fixed uniform array
	setCut( cut ) {

		if ( cut.planes.length > MAX_PLANES ) throw new Error( 'too many facets: ' + cut.planes.length );
		const arr = this.planes.array;
		for ( let i = 0; i < MAX_PLANES; i ++ ) {

			if ( cut.planes[ i ] ) arr[ i ].copy( cut.planes[ i ] );
			else arr[ i ].set( 0, 1, 0, 1e6 );

		}

		this.planeCount.value = cut.planes.length;
		this.radius.value = cut.radius;
		this.cut = cut;

	}

}
