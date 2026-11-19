// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes the built-in ring as GLB (binary glTF 2.0) to models/example.glb.
// Small custom writer, because GLTFExporter needs FileReader in Node.
// Start: node --import ./tools/three-hook.mjs tools/examplemodel.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRing } from '../src/ring.js';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );

export function ringToGlb( { ring, metal, gems } ) {

	ring.updateMatrixWorld( true );

	const groupOf = new Map( gems.map( g => [ g.mesh, g.group ] ) );
	const json = { asset: { version: '2.0', generator: 'Facette example model' }, scene: 0, scenes: [ { nodes: [ 0 ] } ], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], extensionsUsed: [ 'KHR_materials_transmission' ] };
	const chunks = [];
	let offset = 0;

	const view = ( data, target ) => {

		const buf = Buffer.from( data.buffer, data.byteOffset, data.byteLength );
		const pad = ( 4 - ( buf.length % 4 ) ) % 4;
		json.bufferViews.push( { buffer: 0, byteOffset: offset, byteLength: buf.length, target } );
		chunks.push( buf, Buffer.alloc( pad ) );
		offset += buf.length + pad;
		return json.bufferViews.length - 1;

	};

	const accessor = ( data, comp, typ, count, extra = {} ) => {

		json.accessors.push( { bufferView: view( data, extra.target ), componentType: comp, count, type: typ, ...extra.rest } );
		return json.accessors.length - 1;

	};

	// Materials: metal with metallicFactor 1, stones with transmission
	const matIndex = new Map();

	const material = ( m, group ) => {

		const key = group || 'metal';
		if ( matIndex.has( key ) ) return matIndex.get( key );

		if ( ! group ) {

			const c = metal.color;
			json.materials.push( { name: 'Platinum', pbrMetallicRoughness: { baseColorFactor: [ c.r, c.g, c.b, 1 ], metallicFactor: 1, roughnessFactor: metal.roughness } } );

		} else {

			// Center and side stones are recognisable by name, the pavé stones only by transmission
			const name = group === 'center' ? 'diamond-center' : group === 'side' ? 'diamond-side' : 'Material_pave';
			json.materials.push( { name, pbrMetallicRoughness: { baseColorFactor: [ 1, 1, 1, 1 ], metallicFactor: 0, roughnessFactor: 0 }, extensions: { KHR_materials_transmission: { transmissionFactor: 1 } } } );

		}

		matIndex.set( key, json.materials.length - 1 );
		return json.materials.length - 1;

	};

	const meshIndex = new Map();

	const meshFor = ( o ) => {

		const group = groupOf.get( o );
		const key = o.geometry.uuid + '|' + ( group || 'metal' );
		if ( meshIndex.has( key ) ) return meshIndex.get( key );

		const g = o.geometry;
		const pos = g.attributes.position, nor = g.attributes.normal;
		const min = [ Infinity, Infinity, Infinity ], max = [ - Infinity, - Infinity, - Infinity ];

		for ( let i = 0; i < pos.count; i ++ ) for ( let k = 0; k < 3; k ++ ) {

			const v = pos.array[ i * 3 + k ];
			if ( v < min[ k ] ) min[ k ] = v;
			if ( v > max[ k ] ) max[ k ] = v;

		}

		const prim = { attributes: {}, material: material( o.material, group ), mode: 4 };
		prim.attributes.POSITION = accessor( new Float32Array( pos.array ), 5126, 'VEC3', pos.count, { target: 34962, rest: { min, max } } );
		prim.attributes.NORMAL = accessor( new Float32Array( nor.array ), 5126, 'VEC3', nor.count, { target: 34962 } );
		if ( g.index ) prim.indices = accessor( new Uint32Array( g.index.array ), 5125, 'SCALAR', g.index.count, { target: 34963 } );

		json.meshes.push( { name: o.name || 'mesh', primitives: [ prim ] } );
		meshIndex.set( key, json.meshes.length - 1 );
		return json.meshes.length - 1;

	};

	let counter = 0;

	const node = ( o ) => {

		const index = json.nodes.length;
		const n = {};
		json.nodes.push( n );
		o.updateMatrix();
		const group = groupOf.get( o );
		n.name = o === ring ? 'ring' : group === 'center' ? 'diamond-center' : group === 'side' ? 'diamond-side' : group === 'pave' ? 'Mesh' : o.isMesh ? 'metal-' + counter ++ : 'holder';
		if ( ! o.matrix.equals( ring.matrix.clone().identity() ) ) n.matrix = o.matrix.elements.slice();
		if ( o.isMesh ) n.mesh = meshFor( o );
		const children = o.children.map( node );
		if ( children.length ) n.children = children;
		return index;

	};

	node( ring );
	json.buffers.push( { byteLength: offset } );

	let js = Buffer.from( JSON.stringify( json ), 'utf8' );
	js = Buffer.concat( [ js, Buffer.alloc( ( 4 - ( js.length % 4 ) ) % 4, 0x20 ) ] );
	const bin = Buffer.concat( chunks );
	const head = Buffer.alloc( 12 );
	head.writeUInt32LE( 0x46546C67, 0 ); head.writeUInt32LE( 2, 4 ); head.writeUInt32LE( 12 + 8 + js.length + 8 + bin.length, 8 );
	const ck = ( typ, len ) => { const b = Buffer.alloc( 8 ); b.writeUInt32LE( len, 0 ); b.writeUInt32LE( typ, 4 ); return b; };

	return Buffer.concat( [ head, ck( 0x4E4F534A, js.length ), js, ck( 0x004E4942, bin.length ), bin ] );

}

if ( process.argv[ 1 ] && fileURLToPath( import.meta.url ) === process.argv[ 1 ] ) {

	const glb = ringToGlb( buildRing() );
	mkdirSync( join( root, 'models' ), { recursive: true } );
	const target = join( root, 'models', 'example.glb' );
	writeFileSync( target, glb );
	console.log( 'written: ' + target + ' (' + glb.length + ' bytes)' );

}
