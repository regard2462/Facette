// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Mobicat
// Adapted for Facette: ring band cross section from mobicats-jewels (src/band-shape.js),
// dimensions in millimeters, output in Facette units. Round profile as a superellipse with flat
// flanks, dense sampling and normals taken from the cross section itself.
import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';

// Facette units per millimeter (girdle radius 0.33 of the center stone is 2.94 mm)
export const MM = 1 / 8.92;

const smooth = MathUtils.smoothstep;
const lerp = MathUtils.lerp;

export const BAND_CHOICES = {
	shape: [ 'round', 'flat', 'domed', 'knife' ],
	shoulders: [ 'straight', 'taper', 'flare', 'split' ],
	finish: [ 'polished', 'brushed', 'hammered' ],
	edge: [ 'plain', 'bevel', 'beaded' ]
};

// Slider ranges in millimeters
export const BAND_RANGES = {
	width: [ 1.2, 6 ], // rear
	front: [ 1.2, 6.5 ], // at the shoulders
	thickness: [ 0.9, 3.4 ]
};

// Inner radius in millimeters (ring size about 52), band of the default ring
export const BORE = 8.251;
export const BAND_DEFAULT = { width: 1.24, front: 1.52, thickness: 1.03, shape: 'round', shoulders: 'straight', finish: 'polished', edge: 'plain' };

// Bands with several strands per style
const STRANDS = { cable: 2, interlace: 2, double: 2, marquise: 2, fluted: 5 };

// Cross section of the band. a: angle from the head (0 top, ±π rear), strand: strand,
// side: -1/1 left or right half of the cross section, t: 0 top center to π inner center.
// Returns [x, y, z] in Facette units, head at +Y, ring axis Z.
export function bandSurface( style, o, bore = BORE ) {

	const split = o.shoulders === 'split';
	const strands = split ? 1 : STRANDS[ style ] || 1;

	function section( a, strand, side, t ) {

		const angle = Math.abs( a );
		const upper = 1 - smooth( angle, o.shoulders === 'flare' ? 0.62 : 0.38, o.shoulders === 'taper' ? 1.85 : 2.55 );
		const width = Math.max( split ? 3.4 * ( 1 - smooth( angle, 0.15, 0.65 ) ) : 0, lerp( o.width, split ? Math.max( 3.4, o.front ) : o.front, upper ) );
		// rear slightly thinner than front, as on the default ring
		const depth = o.thickness * lerp( 0.82, 1, upper );
		let w = width, h = depth, zc = 0, dr = 0, roll = 0;
		const sign = strand ? 1 : - 1;
		const blend = smooth( angle, 0.12, 0.55 );

		if ( strands === 2 ) {

			w *= 0.58;
			if ( style === 'cable' ) {

				zc = sign * width * 0.21 * Math.sin( 12 * a );
				dr = sign * depth * 0.18 * Math.cos( 12 * a );
				h *= 0.75;

			} else if ( style === 'interlace' ) {

				zc = sign * 0.27 * width * Math.cos( 3 * a );
				dr = sign * 0.15 * depth * Math.sin( 3 * a );
				h *= 0.8;

			} else if ( style === 'marquise' ) zc = sign * width * ( 0.09 + 0.3 * Math.sin( 3 * a ) ** 2 );
			else zc = sign * width * 0.25;

		} else if ( strands === 5 ) {

			w *= 0.32;
			zc = ( strand - 2 ) * width * 0.17;
			h *= 1 - 0.07 * Math.abs( strand - 2 );

		}

		if ( style === 'wishbone' ) zc += 1.9 * Math.exp( - ( a * a ) / 0.15 ) - 0.97 * Math.exp( - ( a * a ) / 0.98 );
		if ( style === 'bypass' ) {

			zc += 1.35 * Math.sin( 2 * a ) * Math.exp( - a * a / 0.94 );
			dr += 0.65 * Math.exp( - a * a / 0.35 );

		}

		if ( style === 'ribbon' ) roll = 0.68 * Math.sin( 3 * a ) * blend;

		const fork = split ? ( 1 - smooth( angle, 0.75, 1.65 ) ) * smooth( angle, 0.04, 0.4 ) : 0;
		const gap = smooth( fork, 0.4, 1 ) * Math.max( 0, Math.min( 0.5, 1 - 2.1 / w ) );
		const u = Math.abs( Math.sin( t ) ), upperFace = t <= Math.PI / 2;
		let arch;

		if ( o.shape === 'round' ) {

			// Superellipse: flat flanks, rounded edges, slightly domed inside
			const n = upperFace ? 3.4 : 2.4;
			arch = Math.pow( Math.max( 0, 1 - Math.pow( u, n ) ), 1 / n );

		} else {

			const n = o.shape === 'flat' ? 6 : o.shape === 'domed' && ! upperFace ? 5 : 2;
			arch = Math.pow( Math.max( 0, 1 - Math.pow( u, n ) ), 1 / n );
			if ( o.shape === 'knife' && upperFace ) arch = Math.pow( Math.max( 0, 1 - u * u / ( 0.07 + 0.93 * u ) ), 0.8 );

		}

		if ( o.edge === 'bevel' ) arch = Math.min( arch, ( 1 - u ) * 2.1 + 0.11 );

		// round the two inner edges of the fork, each arm closes at the opening
		if ( fork > 0 ) {

			const v = Math.min( 1, u / 0.56 );
			arch *= lerp( 1, Math.sqrt( Math.max( 0, 1 - ( 1 - v ) ** 2 ) ), smooth( fork, 0, 0.4 ) );

		}

		const dz = side * ( gap + ( 1 - gap ) * u ) * w / 2;
		const dy = ( upperFace ? 1 : - 1 ) * arch * h / 2;
		const r = bore + depth / 2 + dr + dy * Math.cos( roll ) - dz * Math.sin( roll );
		const z = zc + dz * Math.cos( roll ) + dy * Math.sin( roll );
		return [ r * Math.sin( a ) * MM, r * Math.cos( a ) * MM, z * MM ];

	}

	return { style, o, bore, strands, section };

}

// Highest point of the band top at angle a and position z on the ring axis (units).
// Returns null where there is no metal (opening of a split shoulder, between strands).
export function topAt( surface, a, z, samples = 24 ) {

	let best = null, bestR = - Infinity;

	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		let p = surface.section( a, k, side, 0 );

		for ( let j = 1; j <= samples; j ++ ) {

			const q = surface.section( a, k, side, j / samples * Math.PI / 2 );
			const lo = Math.min( p[ 2 ], q[ 2 ] ), hi = Math.max( p[ 2 ], q[ 2 ] );

			if ( z >= lo - 1e-7 && z <= hi + 1e-7 && hi - lo > 1e-9 ) {

				const s = ( z - p[ 2 ] ) / ( q[ 2 ] - p[ 2 ] );
				const h = [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * s, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * s, z ];
				const r = Math.hypot( h[ 0 ], h[ 1 ] );
				if ( r > bestR ) { bestR = r; best = h; }

			}

			p = q;

		}

	}

	return best;

}

// Band mesh. Normals from the cross section (differences in a and t), so long
// highlights run through the polished metal without facets.
export function sweepBand( surface, { steps = 384, cross = 56 } = {} ) {

	if ( surface.strands > 2 ) cross = Math.round( cross / 2 );
	const pos = [], nor = [], uv = [], idx = [];
	const ea = 1e-4, et = 1e-4;
	const S = surface.section;

	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		const first = pos.length / 3;

		for ( let i = 0; i <= steps; i ++ ) {

			const a = ( i / steps - 0.5 ) * Math.PI * 2;

			for ( let j = 0; j <= cross; j ++ ) {

				const t = j / cross * Math.PI;
				const p = S( a, k, side, t );
				const a0 = S( a - ea, k, side, t ), a1 = S( a + ea, k, side, t );
				const t0 = S( a, k, side, Math.max( 0, t - et ) ), t1 = S( a, k, side, Math.min( Math.PI, t + et ) );
				const da = [ a1[ 0 ] - a0[ 0 ], a1[ 1 ] - a0[ 1 ], a1[ 2 ] - a0[ 2 ] ];
				const dt = [ t1[ 0 ] - t0[ 0 ], t1[ 1 ] - t0[ 1 ], t1[ 2 ] - t0[ 2 ] ];
				// The cross product da × dt points outward for side = -1, inward for side = 1
				let nx = da[ 1 ] * dt[ 2 ] - da[ 2 ] * dt[ 1 ], ny = da[ 2 ] * dt[ 0 ] - da[ 0 ] * dt[ 2 ], nz = da[ 0 ] * dt[ 1 ] - da[ 1 ] * dt[ 0 ];
				const l = Math.hypot( nx, ny, nz ) || 1;
				nx *= - side / l; ny *= - side / l; nz *= - side / l;
				pos.push( ...p );
				nor.push( nx, ny, nz );
				uv.push( i / steps * 12, side * j / cross );

				if ( i < steps && j < cross ) {

					const v = first + i * ( cross + 1 ) + j, b = v + cross + 1;
					if ( side === 1 ) idx.push( v, v + 1, b, b, v + 1, b + 1 );
					else idx.push( v, b, v + 1, b, b + 1, v + 1 );

				}

			}

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	g.setIndex( idx );
	return g;

}
