// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks pavé seats, beads and milgrain edge without a GPU:
// node --import ./tools/three-hook.mjs tools/pavetest.mjs
import { bandSurface, topAt, BAND_DEFAULT, MM } from '../src/band.js';
import { paveLayout, grainGeometry, beadGeometry, scaleForCarat, caratForScale, PAVE_DEFAULT } from '../src/pave.js';
import { makeCut } from '../src/gemcut.js';

const START = 0.63;
const STYLES = [ 'solitaire', 'pave', 'cluster', 'split', 'knife', 'cable', 'interlace', 'double', 'marquise', 'fluted', 'wishbone', 'bypass', 'ribbon', 'dome' ];
let errors = 0, cases = 0, seatTotal = 0, noSeats = 0;
const report = ( text ) => { errors ++; if ( errors <= 30 ) console.log( 'FAIL', text ); };
const finite = ( g ) => g.attributes.position.array.every( Number.isFinite ) && g.attributes.normal.array.every( Number.isFinite );

function band( style ) {

	const o = { ...BAND_DEFAULT };
	if ( style === 'split' ) { o.shoulders = 'split'; o.front = 3.4; }
	if ( style === 'knife' ) o.shape = 'knife';
	if ( style === 'dome' ) { o.front = 5.6; o.width = 4.5; }
	return bandSurface( style, o );

}

// Inner surface of the band at angle a (smallest radius over all strands)
function innerRadius( surface, a ) {

	let r = Infinity;
	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		const p = surface.section( a, k, side, Math.PI );
		r = Math.min( r, Math.hypot( p[ 0 ], p[ 1 ] ) );

	}
	return r;

}

// Carat and scale are inverse to each other
const cut = makeCut( 'brilliant' );
for ( const ct of [ 0.004, 0.0088, 0.03, 0.075 ] ) {

	const r = caratForScale( scaleForCarat( ct, cut ), cut );
	if ( Math.abs( r - ct ) > 1e-9 ) report( 'Carat round trip ' + ct + ' -> ' + r );

}
const sc = scaleForCarat( 0.0088, cut );
if ( Math.abs( sc - 0.0737 ) > 0.001 ) report( 'Scale for 0.0088 ct: ' + sc );

for ( const style of STYLES ) {

	const surface = band( style );

	for ( const rows of [ 1, 2, 3 ] ) for ( const weight of [ 0.004, 0.0088, 0.03 ] ) for ( const pitch of [ 1.0, 1.39, 2.5 ] ) for ( const sizing of [ 'graduated', 'fixed' ] ) for ( const count of [ 7, 14 ] ) {

		const o = { rows, weight, pitch, sizing, count };
		const name = [ style, 'rows' + rows, weight, pitch, sizing, count ].join( '/' );
		cases ++;
		const { seats, max, count: n } = paveLayout( surface, o, START );
		seatTotal += seats.length;
		if ( ! seats.length ) noSeats ++;

		let nan = 0;

		for ( const s of seats ) {

			const v = [ ...s.p.toArray(), ...s.normal.toArray(), ...s.along.toArray(), ...s.across.toArray(), ...s.gemPosition.toArray(), ...s.quaternion.toArray(), s.d, s.scale, s.a ];
			if ( ! v.every( Number.isFinite ) ) nan ++;

		}

		if ( nan ) { report( name + ': ' + nan + ' seats with invalid values' ); continue; }

		// no overlap
		for ( let i = 0; i < seats.length; i ++ ) for ( let j = i + 1; j < seats.length; j ++ ) {

			const a = seats[ i ], b = seats[ j ];
			const need = ( a.d + b.d ) / 2 + 0.07 * MM;
			if ( a.p.distanceTo( b.p ) < need - 1e-9 ) report( name + ': seats ' + a.id + ' and ' + b.id + ' overlap' );

		}

		// girdle rests on metal
		for ( const s of seats ) {

			const bad = [];

			for ( let k = 0; k < 8; k ++ ) {

				const th = k / 8 * Math.PI * 2;
				const q = s.gemPosition.clone().addScaledVector( s.across, Math.cos( th ) * s.d / 2 ).addScaledVector( s.along, Math.sin( th ) * s.d / 2 );
				const a = Math.atan2( q.x, q.y ), top = topAt( surface, a, q.z );
				if ( ! top ) { bad.push( 'without metal' ); continue; }
				const rq = Math.hypot( q.x, q.y );
				const depth = Math.hypot( top[ 0 ], top[ 1 ] ) - rq;
				if ( depth > 0.25 * s.d + 1e-9 ) bad.push( 'too deep ' + ( depth / s.d ).toFixed( 2 ) + ' d' );
				if ( rq < innerRadius( surface, a ) ) bad.push( 'below the inner surface' );

			}

			if ( bad.length ) report( name + ': seat ' + s.id + ', girdle ' + bad[ 0 ] );

		}

		// count per side
		for ( const side of [ 0, 1 ] ) {

			const m = seats.filter( ( s ) => s.side === side && s.row === 0 ).length;
			if ( m > count || m > max || m > n ) report( name + ': ' + m + ' seats on side ' + side + ' (count ' + count + ', max ' + max + ')' );

		}

		// beads
		const g = grainGeometry( seats );
		if ( seats.length && ( ! g || ! g.attributes.position.count ) ) report( name + ': no beads' );
		if ( g && ! finite( g ) ) report( name + ': beads with invalid values' );
		if ( ! seats.length && g ) report( name + ': beads without seats' );

	}

	const b = beadGeometry( surface );
	if ( ! b.attributes.position.count || ! finite( b ) ) report( style + ': milgrain edge invalid' );

}

// Default band (front width 1.52 mm): the pavé sits flush in the band with a 0.1 mm margin,
// max follows from the path length up to 0.62 π.
{

	const r = paveLayout( bandSurface( 'cluster', BAND_DEFAULT ), PAVE_DEFAULT, START );
	console.log( 'Default band: seats', r.seats.length, ', max', r.max, ', count', r.count );
	// as in the default ring: seven stones per side, flush in the band
	if ( r.seats.length !== 14 ) report( 'Default band: expected 14 seats, got ' + r.seats.length );

}

// Wider band: seven stones per side in one row
{

	const surface = bandSurface( 'cluster', { ...BAND_DEFAULT, width: 1.8, front: 2.2 } );
	const r = paveLayout( surface, PAVE_DEFAULT, START );
	const perSide = [ 0, 1 ].map( ( side ) => r.seats.filter( ( s ) => s.side === side && s.row === 0 ).length );
	console.log( 'Band 1.8/2.2: seats per side', perSide.join( '/' ), ', max', r.max, ', count', r.count );
	if ( perSide[ 0 ] !== 7 || perSide[ 1 ] !== 7 || r.seats.some( ( s ) => s.row !== 0 ) ) report( 'Band 1.8/2.2: expected 7 per side in one row, got ' + perSide.join( '/' ) );
	const s0 = r.seats.find( ( s ) => s.i === 0 && s.side === 1 );
	if ( s0 ) console.log( 'first seat: a', ( s0.a * 180 / Math.PI ).toFixed( 2 ), 'deg, girdle radius', Math.hypot( s0.gemPosition.x, s0.gemPosition.y ).toFixed( 4 ), ', seat radius', Math.hypot( s0.p.x, s0.p.y ).toFixed( 4 ), ', scale', s0.scale.toFixed( 4 ), ', d', ( s0.d / MM ).toFixed( 3 ), 'mm' );

}

console.log( cases + ' cases, ' + seatTotal + ' seats, ' + noSeats + ' cases without seats, ' + errors + ' errors' );
console.log( errors ? 'FAILED' : 'PASSED' );
process.exit( errors ? 1 : 0 );
