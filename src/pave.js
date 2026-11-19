// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Mobicat
// Adapted for Facette: pavé seats from mobicats-jewels (src/pave.js), dimensions in millimeters,
// output in Facette units.
import { LatheGeometry, SphereGeometry, Vector2, Vector3, Matrix4, Quaternion, MathUtils } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MM } from './band.js';
import { makeCut, cutVolume } from './gemcut.js';

// Weight in carats, pitch in mm, stones per side
export const PAVE_DEFAULT = { rows: 1, weight: 0.0088, pitch: 1.39, count: 7, sizing: 'graduated' };
export const PAVE_RANGES = { rows: [ 1, 3 ], weight: [ 0.002, 0.075 ], pitch: [ 0.9, 3.5 ], count: [ 0, 14 ] };

// Girdle radius of the brilliant cut in cut units
const GIRDLE = 1.02;
// Minimum band margin beside the stone, gap between stones, smallest stone (mm)
// The pavé sits flush up to the band edge, the beads hold it at the sides
const border = 0.1, clearance = 0.1, minimum = 0.78;
// The row runs from the head to about 112° around the band
const END = 0.62 * Math.PI;
const staggerSpacing = Math.sqrt( 3 ) / 2;

let brilliant = null;
const brilliantCut = () => brilliant || ( brilliant = makeCut( 'brilliant' ) );

// Carat = rho * cut volume * (scale * 8.92 mm)^3 / 200
export function caratForScale( scale, cut = brilliantCut(), rho = 3.52 ) {

	return rho * cutVolume( cut ) * ( scale / MM ) ** 3 / 200;

}

export function scaleForCarat( ct, cut = brilliantCut(), rho = 3.52 ) {

	return Math.cbrt( ct * 200 / ( rho * cutVolume( cut ) ) ) * MM;

}

// Stone diameter in mm for a weight (brilliant, diamond)
const diameterFor = ( ct ) => 2 * GIRDLE * scaleForCarat( ct ) / MM;

const radial = ( p ) => Math.hypot( p.x, p.y );

// Band in millimeters, so all constants apply in mm
function inMm( surface ) {

	return {
		strands: surface.strands,
		section: ( a, k, side, t ) => {

			const p = surface.section( a, k, side, t );
			return [ p[ 0 ] / MM, p[ 1 ] / MM, p[ 2 ] / MM ];

		}
	};

}

// Sample the top skin of each strand, openings of split shoulders stay open
function crossSection( surface, a, inner = false ) {

	const lines = [], spans = [];

	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		const line = [];
		for ( let j = 0; j <= 12; j ++ ) line.push( new Vector3( ...surface.section( a, k, side, inner ? Math.PI - j * Math.PI / 24 : j * Math.PI / 24 ) ) );
		lines.push( line );
		const zs = line.map( ( p ) => p.z );
		spans.push( [ Math.min( ...zs ), Math.max( ...zs ) ] );

	}

	const islands = [];

	for ( const [ lo, hi ] of spans.sort( ( x, y ) => x[ 0 ] - y[ 0 ] ) ) {

		const last = islands.at( - 1 );
		if ( last && lo <= last[ 1 ] + 0.0001 ) last[ 1 ] = Math.max( last[ 1 ], hi );
		else islands.push( [ lo, hi ] );

	}

	function at( z ) {

		let best = null;

		for ( const line of lines ) for ( let j = 1; j < line.length; j ++ ) {

			const p = line[ j - 1 ], q = line[ j ];
			if ( z < Math.min( p.z, q.z ) - 1e-6 || z > Math.max( p.z, q.z ) + 1e-6 || Math.abs( q.z - p.z ) < 1e-8 ) continue;
			const h = p.clone().lerp( q, ( z - p.z ) / ( q.z - p.z ) );
			if ( ! best || radial( h ) > radial( best ) ) best = h;

		}

		return best;

	}

	return { islands, at };

}

// Distribute lanes over the fixed strips. Several rows over one division only if every
// stone on its arm has full support and margin.
function lanes( section, o, target ) {

	const strips = section.islands.map( ( [ lo, hi ] ) => ( { lo, hi, n: 0 } ) );

	for ( let i = 0; i < o.rows; i ++ ) {

		let best, largest = - Infinity;

		for ( const strip of strips ) {

			const available = ( strip.hi - strip.lo - 2 * border - strip.n * staggerSpacing * clearance ) / ( 1 + strip.n * staggerSpacing );
			if ( available > largest + 0.0001 ) { best = strip; largest = available; }

		}

		best.n ++;

	}

	const result = [];

	for ( const { lo, hi, n } of strips ) {

		const room = hi - lo - 2 * border;
		const d = Math.max( 0, Math.min( target, ( room - ( n - 1 ) * staggerSpacing * clearance ) / ( 1 + ( n - 1 ) * staggerSpacing ) ) );

		for ( let j = 0; j < n; j ++ ) {

			const valid = d >= minimum && ( o.sizing === 'graduated' || d >= target - 0.001 );
			result.push( { valid, d, z: ( hi + lo ) / 2 + ( j - ( n - 1 ) / 2 ) * ( d + clearance ) * staggerSpacing } );

		}

	}

	return result;

}

function pathsAlongShoulder( surface, o, diameter, start, sign ) {

	const tracks = Array.from( { length: o.rows }, () => [] );

	for ( let i = 0; i <= 48; i ++ ) {

		const a = sign * MathUtils.lerp( start, END, i / 48 ), section = crossSection( surface, a );

		for ( const [ j, lane ] of lanes( section, o, diameter ).entries() ) {

			const p = section.at( lane.z ) ?? new Vector3( ...surface.section( a, 0, 1, 0.48 ) );
			const prev = tracks[ j ].at( - 1 ), distance = prev ? prev.distance + prev.p.distanceTo( p ) : 0;
			tracks[ j ].push( { a, p, distance } );

		}

	}

	return tracks.map( ( samples ) => ( {
		length: samples.at( - 1 ).distance,
		angle( distance ) {

			const i = samples.findIndex( ( v ) => v.distance >= distance );
			if ( i <= 0 ) return ( i === 0 ? samples[ 0 ] : samples.at( - 1 ) ).a;
			const l = samples[ i - 1 ], r = samples[ i ];
			return MathUtils.lerp( l.a, r.a, ( distance - l.distance ) / ( r.distance - l.distance ) );

		}
	} ) );

}

// Seats on both shoulders. start: first angle (rad) after the head.
// Returns seats in Facette units (p lies on the band top).
export function paveLayout( surface, o, start ) {

	o = { ...PAVE_DEFAULT, ...o };
	if ( start >= END || o.count <= 0 ) return { seats: [], max: 0, count: 0, start };

	const mm = inMm( surface );
	const diameter = diameterFor( o.weight ), pitch = Math.max( o.pitch, diameter + clearance );
	const paths = [ - 1, 1 ].map( ( sign ) => pathsAlongShoulder( mm, o, diameter, start, sign ) );
	const length = Math.min( ...paths.map( ( tracks ) => tracks[ 0 ].length ) );
	const max = Math.max( 0, Math.min( 14, 1 + Math.floor( ( length - diameter / 2 ) / pitch ) ) );
	const count = Math.min( o.count, max );
	const found = [];

	for ( const [ side, tracks ] of paths.entries() ) for ( let i = 0; i < count; i ++ ) for ( let row = 0; row < o.rows; row ++ ) {

		const track = tracks[ row ];
		const dist = ( i + ( row % 2 ) * 0.5 ) * pitch;
		if ( dist + diameter / 2 > track.length ) continue;
		const a = track.angle( dist ), section = crossSection( mm, a ), lane = lanes( section, o, diameter )[ row ];
		if ( ! lane.valid ) continue;
		const { d, z } = lane, p = section.at( z ), left = section.at( z - 0.025 ), right = section.at( z + 0.025 );
		if ( ! p || ! left || ! right ) continue;
		const ahead = crossSection( mm, a + 0.002 ).at( z ), behind = crossSection( mm, a - 0.002 ).at( z );
		if ( ! ahead || ! behind ) continue;
		const along = ahead.sub( behind ).normalize(), across = right.sub( left ).normalize();
		const normal = across.clone().cross( along ).normalize();
		if ( normal.dot( p.clone().setZ( 0 ) ) < 0 ) normal.negate();
		across.crossVectors( along, normal ).normalize();
		// Floor under the pavilion (depth about 0.45 d plus recess): metal stays in place
		const bottom = crossSection( mm, a, true ).at( z );
		if ( ! bottom || p.clone().sub( bottom ).dot( normal ) < d * 0.5 + 0.12 ) continue;
		// Girdle must rest on metal, also in narrow valleys
		const supported = [ - 0.44, 0.44 ].every( ( f ) => {

			const rim = p.clone().addScaledVector( across, d * f ), skin = section.at( rim.z );
			return skin && skin.sub( rim ).dot( normal ) > - d * 0.22;

		} );
		if ( ! supported || found.some( ( s ) => s.p.distanceTo( p ) < ( s.d + d ) / 2 + 0.07 ) ) continue;
		found.push( { i, row, side, a, p, d, along, across, normal, id: row * 100 + i * 2 + side } );

	}

	const seats = [], quat = new Quaternion(), basis = new Matrix4();

	for ( const s of found ) {

		const d = s.d * MM, p = s.p.multiplyScalar( MM );
		const gemPosition = p.clone().addScaledVector( s.normal, - 0.055 * d );
		quat.setFromRotationMatrix( basis.makeBasis( s.along, s.normal, s.across ) );
		seats.push( { i: s.i, row: s.row, side: s.side, a: s.a, id: s.id, p, normal: s.normal, along: s.along, across: s.across, d, scale: d / 2 / GIRDLE, gemPosition, quaternion: quat.clone() } );

	}

	return { seats, max, count, start };

}

// Domed, tapering bead with buried foot and small polished tip
const profile = [ [ 0, 0.55 ], [ 0.24, 0.65 ], [ 0.47, 0.83 ], [ 0.65, 0.98 ], [ 0.74, 1 ], [ 0.84, 0.93 ], [ 0.92, 0.75 ], [ 0.975, 0.44 ], [ 1, 0 ] ];

// Matrices of the beads: two end beads per row end, two caps between adjacent stones.
// All lengths are multiples of d, so they hold in any unit.
function grainMatrices( seats ) {

	const out = [], groups = new Map();

	for ( const s of seats ) {

		const k = s.side + ':' + s.row;
		if ( ! groups.has( k ) ) groups.set( k, [] );
		groups.get( k ).push( s );

	}

	function lip( s, root ) {

		const dir = root.clone().sub( s.p );
		dir.addScaledVector( s.normal, - dir.dot( s.normal ) ).normalize();
		const tip = s.p.clone().addScaledVector( dir, s.d * 0.468 ).addScaledVector( s.normal, s.d * 0.053 );
		const axis = tip.clone().sub( root ), height = axis.length();
		axis.normalize();
		const z = axis.clone().cross( dir ).normalize(), x = axis.clone().cross( z ).normalize();
		out.push( new Matrix4().makeBasis( x, axis, z ).scale( new Vector3( s.d * 0.09, height, s.d * 0.08 ) ).setPosition( root ) );

	}

	function terminal( s, end ) {

		for ( const sign of [ - 1, 1 ] ) {

			const dir = s.along.clone().multiplyScalar( end * 0.8 ).addScaledVector( s.across, sign * 0.6 );
			lip( s, s.p.clone().addScaledVector( dir, 0.53 * s.d ).addScaledVector( s.normal, - 0.12 * s.d ) );

		}

	}

	for ( const line of groups.values() ) {

		const forward = line[ 0 ].side ? 1 : - 1;
		terminal( line[ 0 ], - forward );

		for ( let i = 1; i < line.length; i ++ ) {

			const s = line[ i - 1 ], t = line[ i ], gap = s.p.distanceTo( t.p ) - ( s.d + t.d ) / 2;

			if ( t.i !== s.i + 1 || gap > 0.32 * Math.min( s.d, t.d ) ) {

				terminal( s, forward );
				terminal( t, - forward );
				continue;

			}

			for ( const sign of [ - 1, 1 ] ) {

				const d = Math.min( s.d, t.d ), axis = s.normal.clone().add( t.normal ).normalize();
				const along = t.p.clone().sub( s.p );
				along.addScaledVector( axis, - along.dot( axis ) ).normalize();
				const across = along.clone().cross( axis ).normalize(), offset = sign * 0.19 * d;
				// Ends lie just inside both girdles, the foot in the shared remaining metal
				const edge = ( stone, direction ) => stone.p.clone().addScaledVector( across, offset ).addScaledVector( along, direction * Math.sqrt( ( stone.d * 0.48 ) ** 2 - offset ** 2 ) );
				const left = edge( s, 1 ), right = edge( t, - 1 );
				const foot = left.clone().lerp( right, 0.5 ).addScaledVector( axis, - 0.115 * d );
				out.push( new Matrix4().makeBasis( along, axis, across ).scale( new Vector3( Math.max( 0.075 * d, left.distanceTo( right ) * 0.56 ), 0.19 * d, 0.08 * d ) ).setPosition( foot ) );

			}

		}

		terminal( line.at( - 1 ), forward );

	}

	return out;

}

// Position, normal and index only, so all parts can be merged
function bare( g ) {

	g.deleteAttribute( 'uv' );
	return g;

}

// All beads as one mesh in Facette units. null without seats.
export function grainGeometry( seats ) {

	const mats = grainMatrices( seats );
	if ( ! mats.length ) return null;
	const base = bare( new LatheGeometry( profile.map( ( [ y, r ] ) => new Vector2( r, y ) ), 14 ) );
	return mergeGeometries( mats.map( ( m ) => base.clone().applyMatrix4( m ) ) );

}

// Milgrain edge: count beads per side with radius 0.125 mm at t = 1.19 on the cross section
export function beadGeometry( surface, { count = 154 } = {} ) {

	const ball = bare( new SphereGeometry( 0.125 * MM, 10, 7 ) ), parts = [];

	for ( let i = 0; i < count; i ++ ) for ( const side of [ - 1, 1 ] ) {

		const a = i / count * 2 * Math.PI - Math.PI;
		const p = surface.section( a, side < 0 ? 0 : surface.strands - 1, side, 1.19 );
		parts.push( ball.clone().translate( p[ 0 ], p[ 1 ], p[ 2 ] ) );

	}

	return mergeGeometries( parts );

}
