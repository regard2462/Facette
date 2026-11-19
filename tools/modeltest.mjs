// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks loadModel on models/example.glb against the ring buildRing() produces at runtime.
// Start: node --import ./tools/three-hook.mjs tools/modeltest.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BoxGeometry, SphereGeometry, BufferGeometry, Float32BufferAttribute, Vector3, Box3, Group } from 'three';
import { buildRing } from '../src/ring.js';
import { GemMaterial } from '../src/gem.js';
import { MAX_PLANES } from '../src/gemcut.js';
import { loadModel, planesFromGeometry, describeModel, orientModel } from '../src/model.js';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
let errors = 0;

const check = ( ok, text ) => {

	console.log( ( ok ? 'ok      ' : 'FAIL    ' ) + text );
	if ( ! ok ) errors ++;

};

// Planes of a stone in ring space: normal rotated, distance scaled with size and position
function ringPlanes( mesh, planes ) {

	mesh.updateWorldMatrix( true, false );
	const m = mesh.matrixWorld;
	const s = new Vector3().setFromMatrixColumn( m, 0 ).length();
	const o = new Vector3().setFromMatrixPosition( m );

	return planes.map( p => {

		const n = new Vector3( p.x, p.y, p.z ).transformDirection( m );
		return { n, w: p.w * s + n.dot( o ) };

	} );

}

// 1. Synthetic meshes
{

	const box = planesFromGeometry( new BoxGeometry( 2, 1, 3 ) );
	check( box.planes.length === 6 && box.convex, 'Box: 6 planes, convex (' + box.planes.length + ')' );

	// L-shaped body from two boxes: not convex
	const a = new BoxGeometry( 2, 1, 1 ).toNonIndexed(), b = new BoxGeometry( 1, 2, 1 ).toNonIndexed();
	b.translate( - 0.5, 0.5, 0 );
	const pos = [ ...a.attributes.position.array, ...b.attributes.position.array ];
	const l = new BufferGeometry();
	l.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	const lr = planesFromGeometry( l );
	check( ! lr.convex, 'L-shaped body: detected as not convex' );

	const sphere = planesFromGeometry( new SphereGeometry( 1, 48, 32 ), { limit: 400 } );
	check( sphere.planes.length > MAX_PLANES || sphere.overflow, 'Sphere: over ' + MAX_PLANES + ' planes (' + sphere.planes.length + ')' );

}

// 2. The example ring
const orig = buildRing();
orig.ring.updateMatrixWorld( true );
const buf = readFileSync( join( root, 'models', 'example.glb' ) );
const ab = buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength );
const res = await loadModel( ab, { metal: orig.metal } );
console.log( describeModel( res ) );
res.warnings.forEach( w => console.log( 'Warning: ' + w ) );

check( res.gems.length === orig.gems.length, 'Stone count ' + res.gems.length + ' of ' + orig.gems.length );
check( res.gems[ 0 ] && res.gems[ 0 ].group === 'center', 'gems[0] is the center stone' );
check( res.gems.filter( g => g.group === 'center' ).length === 1, 'exactly one center stone' );
check( res.warnings.length === 0, 'no warnings (' + res.warnings.length + ')' );
check( res.plain.length === 0, 'no stone treated as plain glass' );

for ( const gr of [ 'center', 'side', 'pave' ] ) {

	const o = orig.gems.filter( g => g.group === gr ), n = res.gems.filter( g => g.group === gr );
	check( o.length === n.length, gr + ': count ' + n.length + ' of ' + o.length );
	const expected = o.length ? o[ 0 ].cut.planes.length : 0;
	check( n.every( g => g.cut.planes.length === expected ), gr + ': planes per stone ' + expected + ' (' + [ ...new Set( n.map( g => g.cut.planes.length ) ) ].join( ',' ) + ')' );
	// one material per stone type (the default ring has its own for each side stone, both diamond)
	check( res.mats[ gr ].length === new Set( o.map( g => g.mesh.material.stone ) ).size && res.mats[ gr ].every( m => m instanceof GemMaterial ), gr + ': materials ' + res.mats[ gr ].length );
	check( n.every( g => res.mats[ gr ].includes( g.mesh.material ) && g.mesh.castShadow === false ), gr + ': material from mats, no shadow casting' );

}

// all planes convex: original cuts and loaded meshes
const seen = new Set();
const allConvex = res.gems.every( g => {

	if ( seen.has( g.cut ) ) return true;
	seen.add( g.cut );
	return planesFromGeometry( g.mesh.geometry ).convex;

} );
check( allConvex, 'all loaded stones convex' );

// Position and size: every original plane reappears in ring space
const free = res.gems.map( ( g, i ) => i );
let hits = 0;

for ( const og of orig.gems ) {

	const oe = ringPlanes( og.mesh, og.cut.planes );
	const i = free.find( k => {

		if ( res.gems[ k ].group !== og.group ) return false;
		const ne = ringPlanes( res.gems[ k ].mesh, res.gems[ k ].cut.planes );
		return oe.every( p => ne.some( q => q.n.angleTo( p.n ) < 0.2 * Math.PI / 180 && Math.abs( q.w - p.w ) < 1e-3 ) );

	} );

	if ( i !== undefined ) { hits ++; free.splice( free.indexOf( i ), 1 ); }

}

check( hits === orig.gems.length, 'Position and size: ' + hits + ' of ' + orig.gems.length + ' stones match the original' );

// Metal
const metals = [];
res.ring.traverse( o => { if ( o.isMesh && ! res.gems.some( g => g.mesh === o ) ) metals.push( o ); } );
const origMetal = [];
orig.ring.traverse( o => { if ( o.isMesh && ! orig.gems.some( g => g.mesh === o ) ) origMetal.push( o ); } );
check( metals.length > 0 && metals.length === origMetal.length, 'Metal parts ' + metals.length + ' of ' + origMetal.length );
check( metals.every( o => o.material === orig.metal ), 'all metal parts use the viewer metal material' );
check( metals.some( o => o.castShadow ) && metals.every( o => o.castShadow === o.receiveShadow || ! o.castShadow ), 'Shadows of the metal parts set (' + metals.filter( o => o.castShadow ).length + ' cast)' );

// 3. Orientation: rotated, shifted and scaled models land like the example ring
{

	const ref = buildRing();
	ref.ring.updateMatrixWorld( true );
	const refBox = new Box3().setFromObject( ref.ring );
	const width = refBox.getSize( new Vector3() ).x;
	let expected = null, expectedBox = null;
	const cases = [
		[ 'unchanged', [ 0, 0, 0 ], 1 ],
		[ 'head along Z, times 7', [ Math.PI / 2, 0, 0 ], 7 ],
		[ 'head down, axes swapped, times 0.05', [ Math.PI, 0, Math.PI / 2 ], 0.05 ],
		[ 'finger axis X, times 30', [ 0, Math.PI / 2, 0 ], 30 ],
		// only the shoulder stones count: their centroid must still point to the head
		[ 'pavé only as stones, head along -X', [ 0, 0, Math.PI / 2 ], 3, true ]
	];

	for ( const [ name, euler, s, paveOnly ] of cases ) {

		const r = await loadModel( ab, { metal: ref.metal } );
		if ( paveOnly ) r.gems = r.gems.filter( g => g.group === 'pave' );
		const g = new Group();
		g.rotation.set( ...euler );
		g.scale.setScalar( s );
		g.position.set( 3, - 2, 1 );
		for ( const c of [ ...r.ring.children ] ) g.add( c );
		r.ring.add( g );
		orientModel( r, width );
		r.ring.updateMatrixWorld( true );
		const actual = r.gems[ 0 ].mesh.getWorldPosition( new Vector3() );
		const box = new Box3().setFromObject( r.ring );

		if ( ! expected ) {

			// The band center is estimated as bottom edge plus half the width. The example ring
			// is wider at the shoulders than at the bottom, so it sits up to 0.05 lower than buildRing.
			expected = actual; expectedBox = box;
			const dev = Math.max( box.min.distanceTo( refBox.min ), box.max.distanceTo( refBox.max ) );
			check( dev < 0.05 && Math.abs( box.getSize( new Vector3() ).x - width ) < 1e-6, 'Orientation ' + name + ': matches buildRing within ' + dev.toFixed( 3 ) );
			continue;

		}

		const dev = Math.max( paveOnly ? 0 : actual.distanceTo( expected ), box.min.distanceTo( expectedBox.min ), box.max.distanceTo( expectedBox.max ) );
		check( dev < 1e-3, 'Orientation ' + name + ': matches unchanged within ' + dev.toExponential( 1 ) );

	}

}

console.log( errors ? '\n' + errors + ' errors' : '\nall passed' );
process.exit( errors ? 1 : 0 );
