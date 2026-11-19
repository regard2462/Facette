// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks the ring editor without a GPU: all styles with several cuts, weights and profiles.
// node --import ./tools/three-hook.mjs tools/designtest.mjs
import { Box3, Vector3 } from 'three';
import { buildDesign, DEFAULT_DESIGN, STYLES, PROFILES, styleDefaults, scaleFor, caratFor, testMetal } from '../src/design.js';
import { buildRing, layDown } from '../src/ring.js';
import { GemMaterial, STONE_BY_ID } from '../src/gem.js';
import { makeCut, CUTS } from '../src/gemcut.js';
import { createHash } from 'node:crypto';

let errors = 0;
const report = ( t ) => { errors ++; if ( errors <= 40 ) console.log( 'FAIL', t ); };

const metal = testMetal();
const pool = new Map();
const material = ( key, cut ) => {

	let m = pool.get( key );
	if ( ! m ) { m = new GemMaterial( cut, STONE_BY_ID[ 'lab-diamond' ] ); pool.set( key, m ); } else if ( m.cut !== cut ) m.setCut( cut );
	return m;

};

const hash = ( ring ) => {

	ring.updateMatrixWorld( true );
	const h = createHash( 'sha256' ), v = new Vector3();
	ring.traverse( o => {

		if ( ! o.isMesh ) return;
		const p = o.geometry.attributes.position, out = new Float32Array( p.count * 3 );
		for ( let i = 0; i < p.count; i ++ ) v.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld ).toArray( out, i * 3 );
		h.update( Buffer.from( out.buffer ) );

	} );
	return h.digest( 'hex' ).slice( 0, 16 );

};

// 1. The default design builds the hand-placed ring unchanged
{

	const a = buildRing().ring, b = buildDesign( DEFAULT_DESIGN, { material, metal } ).ring;
	if ( hash( a ) !== hash( b ) ) report( 'Default design differs from the hand-placed ring' );
	else console.log( 'Default design: identical to the hand-placed ring' );

}

// 2. Carat: a 1 ct diamond brilliant measures 6.4 to 6.5 mm
{

	const cut = makeCut( 'brilliant' );
	const mm = 2 * 1.02 * scaleFor( cut, 1, 3.52 ) * 8.92;
	if ( mm < 6.35 || mm > 6.55 ) report( '1 ct brilliant measures ' + mm.toFixed( 2 ) + ' mm' );
	console.log( '1 ct brilliant:', mm.toFixed( 2 ), 'mm; default stone', caratFor( cut, 0.33, 3.52 ).toFixed( 3 ), 'ct' );

}

// 3. All styles build without invalid values, with a center stone, within sensible bounds
const cuts = [ 'brilliant', 'oval', 'emerald', 'pear', 'princess', 'marquise', 'trillion', 'rose' ];
let n = 0;

for ( const s of STYLES ) for ( const cut of cuts ) for ( const carat of [ 0.5, 1.5, 3 ] ) for ( const profile of Object.keys( PROFILES ) ) {

	if ( profile !== 'classic' && carat !== 1.5 ) continue;
	const d = { ...structuredClone( DEFAULT_DESIGN ), style: s.id, cut, carat, profile, ...styleDefaults( s.id ) };
	const name = [ s.id, cut, carat, profile ].join( '/' );
	let res;

	try {

		res = buildDesign( d, { material, metal } );

	} catch ( e ) {

		report( name + ': ' + e.message );
		continue;

	}

	n ++;
	let nan = 0;
	res.ring.traverse( o => { if ( o.isMesh && o.geometry.attributes.position.array.some( x => ! Number.isFinite( x ) ) ) nan ++; } );
	if ( nan ) report( name + ': ' + nan + ' meshes with invalid values' );
	const groups = res.gems.map( g => g.group );
	if ( groups.filter( g => g === 'center' ).length !== 1 ) report( name + ': no center stone' );
	if ( ( s.id === 'trilogy' || s.id === 'cluster' ) && groups.filter( g => g === 'side' ).length !== 2 ) report( name + ': side stones missing' );
	if ( ( s.id === 'pave' || s.id === 'cluster' ) && ! groups.includes( 'pave' ) ) report( name + ': no pavé' );
	const size = new Box3().setFromObject( res.ring ).getSize( new Vector3() );
	// A 3 ct marquise is about 16 mm long (1.8 units), a 3 ct trilogy about 26 mm wide
	if ( size.x > 3.2 || size.y > 3.2 || size.z > 2.0 ) report( name + ': ring too large ' + size.toArray().map( v => v.toFixed( 2 ) ) );
	layDown( res.ring );
	if ( ! Number.isFinite( res.ring.rotation.x ) ) report( name + ': laying down failed' );

}

// 4. Material pool: at most four stone materials, no matter how many rebuilds
if ( pool.size > 4 ) report( 'Material pool grows: ' + pool.size );

console.log( n + ' designs built, ' + pool.size + ' stone materials' );
console.log( errors ? errors + ' errors' : 'designs: all passed' );
process.exitCode = errors ? 1 : 0;
