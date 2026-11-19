// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks that buildRing() without arguments returns the default ring: per mesh the kind, vertex
// count, bounding box and a checksum of the vertices, per stone the group, position and size.
// Previews, GLB and demo video show this ring. With --update the current state is saved as the reference.
// node --import ./tools/three-hook.mjs tools/defaultring.mjs [--update]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { buildRing } from '../src/ring.js';

const file = join( dirname( fileURLToPath( import.meta.url ) ), 'defaultring.json' );
const r6 = ( v ) => Math.round( v * 1e5 ) / 1e5;

const { ring, gems } = buildRing();
ring.updateMatrixWorld( true );
const stones = new Map( gems.map( g => [ g.mesh, g.group ] ) );
const parts = [];

ring.traverse( ( o ) => {

	if ( ! o.isMesh ) return;
	const p = o.geometry.attributes.position;
	let sum = 0;
	for ( let i = 0; i < p.array.length; i ++ ) sum += p.array[ i ] * ( ( i % 7 ) + 1 );
	const box = new Box3().setFromBufferAttribute( p ).applyMatrix4( o.matrixWorld );
	parts.push( { kind: stones.get( o ) || 'metal', vertices: p.count, index: o.geometry.index ? o.geometry.index.count : 0, sum: r6( sum ), box: [ ...box.min.toArray(), ...box.max.toArray() ].map( r6 ) } );

} );

const layout = gems.map( g => ( { group: g.group, pos: g.mesh.getWorldPosition( new Vector3() ).toArray().map( r6 ), size: r6( g.mesh.getWorldScale( new Vector3() ).x ) } ) );
const current = { parts, stones: layout };

if ( process.argv.includes( '--update' ) || ! existsSync( file ) ) {

	writeFileSync( file, JSON.stringify( current ) );
	console.log( 'Reference saved:', parts.length, 'meshes,', layout.length, 'stones' );
	process.exit( 0 );

}

const ref = JSON.parse( readFileSync( file, 'utf8' ) );
const errors = [];
const same = ( a, b ) => Math.abs( a - b ) <= 1e-3 * Math.max( 1, Math.abs( a ), Math.abs( b ) );

if ( ref.parts.length !== parts.length ) errors.push( `Meshes ${ parts.length }, expected ${ ref.parts.length }` );
ref.parts.forEach( ( a, i ) => {

	const b = parts[ i ];
	if ( ! b ) return;
	if ( a.kind !== b.kind || a.vertices !== b.vertices || a.index !== b.index ) errors.push( `Mesh ${ i }: ${ b.kind }/${ b.vertices }/${ b.index }, expected ${ a.kind }/${ a.vertices }/${ a.index }` );
	else if ( ! same( a.sum, b.sum ) || a.box.some( ( v, k ) => ! same( v, b.box[ k ] ) ) ) errors.push( `Mesh ${ i } (${ a.kind }): position or shape moved` );

} );

if ( ref.stones.length !== layout.length ) errors.push( `Stones ${ layout.length }, expected ${ ref.stones.length }` );
ref.stones.forEach( ( a, i ) => {

	const b = layout[ i ];
	if ( b && ( a.group !== b.group || ! same( a.size, b.size ) || a.pos.some( ( v, k ) => ! same( v, b.pos[ k ] ) ) ) ) errors.push( `Stone ${ i } (${ a.group }) moved` );

} );

if ( errors.length ) {

	console.log( 'FAIL    Default ring differs:\n  ' + errors.slice( 0, 20 ).join( '\n  ' ) );
	process.exit( 1 );

}

console.log( 'ok      Default ring unchanged:', parts.length, 'meshes,', layout.length, 'stones' );
