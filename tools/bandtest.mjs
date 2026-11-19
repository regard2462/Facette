// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks the band of all styles and shapes without a GPU:
// node --import ./tools/three-hook.mjs tools/bandtest.mjs
import { bandSurface, sweepBand, topAt, BAND_DEFAULT, BAND_CHOICES, BORE, MM } from '../src/band.js';

const STYLES = [ 'solitaire', 'trilogy', 'pave', 'cathedral', 'split', 'eastwest', 'knife', 'dome', 'cluster', 'cable', 'ribbon', 'wishbone', 'bypass', 'interlace', 'double', 'marquise', 'fluted', 'petal' ];
let errors = 0;
const report = ( text ) => { errors ++; if ( errors < 30 ) console.log( 'FAIL', text ); };

for ( const style of STYLES ) for ( const shape of BAND_CHOICES.shape ) for ( const shoulders of BAND_CHOICES.shoulders ) for ( const edge of [ 'plain', 'bevel' ] ) {

	const o = { ...BAND_DEFAULT, shape, shoulders, edge };
	const s = bandSurface( style, o );
	const g = sweepBand( s, { steps: 96, cross: 16 } );
	const p = g.attributes.position.array, n = g.attributes.normal.array;
	const name = [ style, shape, shoulders, edge ].join( '/' );
	let nan = 0, inside = 0, samples = 0;

	for ( let i = 0; i < p.length; i += 3 ) {

		if ( ! Number.isFinite( p[ i ] + p[ i + 1 ] + p[ i + 2 ] + n[ i ] + n[ i + 1 ] + n[ i + 2 ] ) ) nan ++;

	}

	// Outer side: the normal points away from the ring center (strand 0, right half, top center)
	for ( let k = 0; k < 64; k ++ ) {

		const a = ( k / 64 - 0.5 ) * Math.PI * 2;
		const q = s.section( a, 0, 1, 0.05 ), q2 = s.section( a, 0, 1, Math.PI - 0.05 );
		samples ++;
		if ( Math.hypot( q[ 0 ], q[ 1 ] ) <= Math.hypot( q2[ 0 ], q2[ 1 ] ) && style !== 'ribbon' ) inside ++;

	}

	if ( nan ) report( name + ': ' + nan + ' invalid values' );
	if ( inside ) report( name + ': ' + inside + ' of ' + samples + ' places with the outer side facing inward' );

	// Mesh: triangle normals and stored normals point the same way
	const idx = g.index.array;
	let flipped = 0;
	for ( let i = 0; i < idx.length; i += 3 ) {

		const [ A, B, C ] = [ idx[ i ] * 3, idx[ i + 1 ] * 3, idx[ i + 2 ] * 3 ];
		const u = [ p[ B ] - p[ A ], p[ B + 1 ] - p[ A + 1 ], p[ B + 2 ] - p[ A + 2 ] ];
		const v = [ p[ C ] - p[ A ], p[ C + 1 ] - p[ A + 1 ], p[ C + 2 ] - p[ A + 2 ] ];
		const fn = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
		const l = Math.hypot( ...fn );
		if ( l < 1e-12 ) continue;
		const d = ( fn[ 0 ] * ( n[ A ] + n[ B ] + n[ C ] ) + fn[ 1 ] * ( n[ A + 1 ] + n[ B + 1 ] + n[ C + 1 ] ) + fn[ 2 ] * ( n[ A + 2 ] + n[ B + 2 ] + n[ C + 2 ] ) ) / l;
		if ( d < - 0.5 ) flipped ++;

	}

	if ( flipped > idx.length / 3 * 0.002 ) report( name + ': ' + flipped + ' triangles facing against their normal' );

}

// Dimensions of the default ring: top edge at the head, front width
{

	const s = bandSurface( 'solitaire', BAND_DEFAULT );
	const top = s.section( 0, 0, 1, 0 )[ 1 ];
	const expected = ( BORE + BAND_DEFAULT.thickness ) * MM;
	if ( Math.abs( top - expected ) > 1e-6 ) report( 'Top edge at the head ' + top + ', expected ' + expected );
	const width = 2 * s.section( 0, 0, 1, Math.PI / 2 )[ 2 ];
	if ( Math.abs( width - BAND_DEFAULT.front * MM ) > 1e-6 ) report( 'Front width ' + width );
	const h = topAt( s, 0, 0 );
	if ( ! h || Math.abs( h[ 1 ] - expected ) > 1e-4 ) report( 'topAt at the head ' + h );
	console.log( 'Default band: top edge', top.toFixed( 4 ), 'front width', width.toFixed( 4 ) );

}

// Split shoulders: no metal between the arms
{

	const s = bandSurface( 'split', { ...BAND_DEFAULT, shoulders: 'split', front: 3.4 } );
	if ( topAt( s, 0.9, 0 ) ) report( 'split shoulders: metal in the opening' );
	if ( ! topAt( s, 0, 0 ) ) report( 'split shoulders: no metal at the head' );

}

console.log( errors ? errors + ' errors' : 'band: all passed' );
process.exitCode = errors ? 1 : 0;
