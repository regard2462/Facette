// SPDX-License-Identifier: AGPL-3.0-or-later
// Load custom rings as GLB. Stones are decomposed into facet planes so the gemstone shader
// can render them; everything else is metal and gets the metal material of the viewer.
import {
	Group, Mesh, BufferGeometry, Float32BufferAttribute, Vector3, Vector4, Matrix4, Quaternion,
	MeshPhysicalNodeMaterial, Color, Box3
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { buildGem, MAX_PLANES } from './gemcut.js';
import { GemMaterial, STONES } from './gem.js';

const RAD = Math.PI / 180;

// Triangles as a flat list: 9 numbers per triangle
function triangleData( geometry ) {

	const pos = geometry.attributes.position;
	if ( ! pos ) return new Float64Array( 0 );
	const idx = geometry.index;
	const n = Math.floor( ( idx ? idx.count : pos.count ) / 3 );
	const out = new Float64Array( n * 9 );

	for ( let t = 0; t < n; t ++ ) for ( let k = 0; k < 3; k ++ ) {

		const i = idx ? idx.getX( t * 3 + k ) : t * 3 + k;
		out[ t * 9 + k * 3 ] = pos.getX( i );
		out[ t * 9 + k * 3 + 1 ] = pos.getY( i );
		out[ t * 9 + k * 3 + 2 ] = pos.getZ( i );

	}

	return out;

}

// Planes of a mesh: group triangles by normal and distance.
// The result is centered on the center of the vertex bounds and normalised to bounding radius 1.
// limit: stops as soon as more groups appear (overflow = true).
export function planesFromGeometry( geometry, { angleTol = 0.5, distTol = 1e-3, limit = Infinity } = {} ) {

	const pos = geometry.attributes.position;
	const tri = triangleData( geometry );
	const nTri = tri.length / 9;
	const center = new Vector3();
	if ( ! pos || nTri === 0 ) return { planes: [], convex: false, center, radius: 0 };

	// Bounds of all vertices
	const min = new Vector3( Infinity, Infinity, Infinity ), max = new Vector3( - Infinity, - Infinity, - Infinity );
	const v = new Vector3();

	for ( let i = 0; i < pos.count; i ++ ) {

		v.fromBufferAttribute( pos, i );
		min.min( v ); max.max( v );

	}

	center.addVectors( min, max ).multiplyScalar( 0.5 );
	let radius = 0;
	for ( let i = 0; i < pos.count; i ++ ) radius = Math.max( radius, v.fromBufferAttribute( pos, i ).distanceTo( center ) );
	if ( radius <= 0 ) return { planes: [], convex: false, center, radius: 0 };

	const tolD = distTol * radius;
	const cosTol = Math.cos( angleTol * RAD );
	const sliver = 1e-6 * radius * radius;

	// Normals, areas, centroids
	const nor = new Float64Array( nTri * 3 ), area = new Float64Array( nTri ), cen = new Float64Array( nTri * 3 );
	const P = new Vector3();
	let areaSum = 0;
	const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), nn = new Vector3();

	for ( let t = 0; t < nTri; t ++ ) {

		const o = t * 9;
		a.set( tri[ o ], tri[ o + 1 ], tri[ o + 2 ] ); b.set( tri[ o + 3 ], tri[ o + 4 ], tri[ o + 5 ] ); c.set( tri[ o + 6 ], tri[ o + 7 ], tri[ o + 8 ] );
		nn.crossVectors( e1.subVectors( b, a ), e2.subVectors( c, a ) );
		const l = nn.length();
		area[ t ] = l / 2;
		if ( l > 0 ) nn.divideScalar( l );
		nor[ t * 3 ] = nn.x; nor[ t * 3 + 1 ] = nn.y; nor[ t * 3 + 2 ] = nn.z;
		cen[ t * 3 ] = ( a.x + b.x + c.x ) / 3; cen[ t * 3 + 1 ] = ( a.y + b.y + c.y ) / 3; cen[ t * 3 + 2 ] = ( a.z + b.z + c.z ) / 3;
		P.x += cen[ t * 3 ] * area[ t ]; P.y += cen[ t * 3 + 1 ] * area[ t ]; P.z += cen[ t * 3 + 2 ] * area[ t ];
		areaSum += area[ t ];

	}

	if ( areaSum <= 0 ) return { planes: [], convex: false, center, radius };
	P.divideScalar( areaSum ); // area centroid, inside for convex bodies

	// Orient normals outward, independent of the triangle order in the model
	for ( let t = 0; t < nTri; t ++ ) {

		const d = nor[ t * 3 ] * ( cen[ t * 3 ] - P.x ) + nor[ t * 3 + 1 ] * ( cen[ t * 3 + 1 ] - P.y ) + nor[ t * 3 + 2 ] * ( cen[ t * 3 + 2 ] - P.z );
		if ( d < 0 ) { nor[ t * 3 ] *= - 1; nor[ t * 3 + 1 ] *= - 1; nor[ t * 3 + 2 ] *= - 1; }

	}

	// Large triangles first, they fix the planes
	const order = Array.from( { length: nTri }, ( _, i ) => i ).filter( i => area[ i ] > 0 ).sort( ( p, q ) => area[ q ] - area[ p ] );
	const clusters = [];
	let overflow = false;

	for ( const t of order ) {

		const o = t * 9;
		const small = area[ t ] < sliver;
		let hit = null;

		for ( const cl of clusters ) {

			if ( ! small && nor[ t * 3 ] * cl.n.x + nor[ t * 3 + 1 ] * cl.n.y + nor[ t * 3 + 2 ] * cl.n.z < cosTol ) continue;
			let ok = true;

			for ( let k = 0; k < 3 && ok; k ++ ) {

				const d = cl.n.x * tri[ o + k * 3 ] + cl.n.y * tri[ o + k * 3 + 1 ] + cl.n.z * tri[ o + k * 3 + 2 ] - cl.w;
				if ( Math.abs( d ) > tolD ) ok = false;

			}

			if ( ok ) { hit = cl; break; }

		}

		// tiny triangles without a matching plane are numerical noise and are ignored
		if ( ! hit ) {

			if ( small ) continue;
			hit = { n: new Vector3(), w: 0, sn: new Vector3(), sc: new Vector3(), sa: 0 };
			clusters.push( hit );
			if ( clusters.length > limit ) { overflow = true; break; }

		}

		const A = area[ t ];
		hit.sn.x += nor[ t * 3 ] * A; hit.sn.y += nor[ t * 3 + 1 ] * A; hit.sn.z += nor[ t * 3 + 2 ] * A;
		hit.sc.x += cen[ t * 3 ] * A; hit.sc.y += cen[ t * 3 + 1 ] * A; hit.sc.z += cen[ t * 3 + 2 ] * A;
		hit.sa += A;
		hit.n.copy( hit.sn ).normalize();
		hit.w = hit.n.dot( hit.sc ) / hit.sa;

	}

	const planes = clusters.map( cl => new Vector4( cl.n.x, cl.n.y, cl.n.z, ( cl.w - cl.n.dot( center ) ) / radius ) );
	if ( overflow ) return { planes, convex: false, overflow, center, radius };

	// Convex: all vertices lie inside all planes (within tolerance)
	let convex = planes.length >= 4;
	const tolC = 2 * distTol;

	for ( let j = 0; j < planes.length && convex; j ++ ) {

		const p = planes[ j ];

		for ( let i = 0; i < pos.count; i ++ ) {

			v.fromBufferAttribute( pos, i ).sub( center ).divideScalar( radius );
			if ( p.x * v.x + p.y * v.y + p.z * v.z - p.w > tolC ) { convex = false; break; }

		}

	}

	return { planes, convex, center, radius };

}

// Convex hull of all vertices as a triangle mesh
function hullGeometry( geometry ) {

	const pos = geometry.attributes.position;
	const seen = new Set(), pts = [];
	const v = new Vector3();
	geometry.computeBoundingSphere();
	const q = 1e6 / Math.max( geometry.boundingSphere.radius, 1e-9 );

	for ( let i = 0; i < pos.count; i ++ ) {

		v.fromBufferAttribute( pos, i );
		const key = Math.round( v.x * q ) + ',' + Math.round( v.y * q ) + ',' + Math.round( v.z * q );
		if ( seen.has( key ) ) continue;
		seen.add( key );
		pts.push( v.clone() );

	}

	const out = new BufferGeometry();
	if ( pts.length < 4 ) return out;

	const hull = new ConvexHull().setFromPoints( pts );
	const p = [];

	for ( const face of hull.faces ) {

		const ring = [];
		let e = face.edge;

		do {

			ring.push( e.head().point );
			e = e.next;

		} while ( e !== face.edge );

		for ( let k = 1; k < ring.length - 1; k ++ ) for ( const r of [ ring[ 0 ], ring[ k ], ring[ k + 1 ] ] ) p.push( r.x, r.y, r.z );

	}

	out.setAttribute( 'position', new Float32BufferAttribute( p, 3 ) );
	return out;

}

// Stone detection
const STONE_RE = /(^|[^a-z])(diamond|diamant|brilliant|gem|stone|stein|edelstein|emerald|smaragd|ruby|rubin|sapphire|saphir|crystal|kristall|topas|topaz|amethyst|aquamarin|morganit|jewel|glas|glass|cz([^a-z]|$))/;
const METAL_RE = /fassung|krappe|prong|setting|bezel|halter|schiene|shank|mount|claw|metal|gold|platin|silver|silber/;

const clean = s => String( s || '' ).replace( /([a-z])([A-Z])/g, '$1 $2' ).toLowerCase();

const nameIsStone = name => {

	const s = clean( name );
	if ( ! s || METAL_RE.test( s ) ) return false;
	return STONE_RE.test( s );

};

const glassy = m => !! m && ( ( m.transmission || 0 ) > 0 || ( m.transparent && m.opacity < 1 ) );

// Stone kind from the names, otherwise diamond
function stoneKind( names ) {

	const s = clean( names.join( ' ' ) );
	if ( /diamond|diamant|brilliant/.test( s ) ) return 'diamond';
	if ( /saphir|sapphire/.test( s ) ) return 'sapphire';
	if ( /rubin|ruby/.test( s ) ) return 'ruby';
	if ( /smaragd|emerald/.test( s ) ) return 'emerald';
	if ( /aquamarin/.test( s ) ) return 'aquamarine';
	if ( /morganit/.test( s ) ) return 'morganite';
	return 'diamond';

}

// Resolve InstancedMesh (EXT_mesh_gpu_instancing) into single meshes
function dissolveInstances( root ) {

	const list = [];
	root.traverse( o => { if ( o.isInstancedMesh ) list.push( o ); } );
	const m = new Matrix4();

	for ( const im of list ) {

		const g = new Group();
		g.name = im.name;
		g.position.copy( im.position ); g.quaternion.copy( im.quaternion ); g.scale.copy( im.scale );

		for ( let i = 0; i < im.count; i ++ ) {

			im.getMatrixAt( i, m );
			const mesh = new Mesh( im.geometry, im.material );
			mesh.name = ( im.name || 'instance' ) + '_' + i;
			m.decompose( mesh.position, mesh.quaternion, mesh.scale );
			g.add( mesh );

		}

		const parent = im.parent;
		parent.add( g );
		parent.remove( im );

	}

}

// Planes, cut and position of a stone from its geometry
function analyse( geometry, name, warnings ) {

	let r = planesFromGeometry( geometry, { limit: 400 } );
	let hulled = false;

	if ( ! r.overflow && ! r.convex ) {

		const hg = hullGeometry( geometry );
		if ( hg.attributes.position ) {

			r = planesFromGeometry( hg, { limit: 400 } );
			hulled = true;
			warnings.push( 'Stone "' + name + '" is not convex, using the convex hull as an approximation' );

		}

	}

	const fail = why => { warnings.push( 'Stone "' + name + '": ' + why + ', stays plain glass' ); return { cut: null }; };

	if ( r.overflow || r.planes.length > MAX_PLANES ) return fail( ( r.overflow ? 'over 400' : r.planes.length ) + ' planes (maximum ' + MAX_PLANES + ')' );
	if ( r.planes.length < 4 ) return fail( 'too few planes' );

	const cut = buildGem( r.planes );
	if ( cut.planes.length > MAX_PLANES ) return fail( cut.planes.length + ' planes (maximum ' + MAX_PLANES + ')' );
	if ( cut.planes.length < 4 || cut.radius > 1.1 ) return fail( 'mesh is not closed' );

	return { cut, center: r.center, radius: r.radius, hulled };

}

// Loads a GLB (ArrayBuffer or URL) and prepares it for the viewer.
export async function loadModel( source, { metal } = {} ) {

	const loader = new GLTFLoader();
	let gltf;

	if ( typeof source === 'string' ) gltf = await loader.loadAsync( source );
	else {

		const buf = ArrayBuffer.isView( source ) ? source.buffer.slice( source.byteOffset, source.byteOffset + source.byteLength ) : source;
		gltf = await loader.parseAsync( buf, '' );

	}

	const ring = gltf.scene;
	const warnings = [];
	dissolveInstances( ring );
	ring.updateMatrixWorld( true );
	const ringInv = ring.matrixWorld.clone().invert();

	const parts = [];
	ring.traverse( o => { if ( o.isMesh ) parts.push( o ); } );
	for ( const o of parts ) o.userData.rel = ringInv.clone().multiply( o.matrixWorld );

	// Overall radius from (sampled) vertices in ring space
	const pts = [];
	const w = new Vector3();

	for ( const o of parts ) {

		const p = o.geometry.attributes.position;
		if ( ! p ) continue;
		const stride = Math.max( 1, Math.ceil( p.count / 20000 ) );

		for ( let i = 0; i < p.count; i += stride ) {

			w.fromBufferAttribute( p, i ).applyMatrix4( o.userData.rel );
			pts.push( w.x, w.y, w.z );

		}

	}

	const lo = new Vector3( Infinity, Infinity, Infinity ), hi = new Vector3( - Infinity, - Infinity, - Infinity );
	for ( let i = 0; i < pts.length; i += 3 ) { w.set( pts[ i ], pts[ i + 1 ], pts[ i + 2 ] ); lo.min( w ); hi.max( w ); }
	const mid = new Vector3().addVectors( lo, hi ).multiplyScalar( 0.5 );
	let total = 0;
	for ( let i = 0; i < pts.length; i += 3 ) total = Math.max( total, w.set( pts[ i ], pts[ i + 1 ], pts[ i + 2 ] ).distanceTo( mid ) );

	// Separate stones and metal
	const stones = [], metals = [];

	for ( const o of parts ) {

		const mats = Array.isArray( o.material ) ? o.material : [ o.material ];
		const glass = mats.every( glassy );
		const named = nameIsStone( o.name ) || mats.some( m => nameIsStone( m.name ) );

		if ( glass || named ) stones.push( o );
		else metals.push( o );

		if ( ! glass && mats.some( glassy ) ) warnings.push( 'Part "' + o.name + '" mixes glass and metal in one mesh, treated as ' + ( stones.includes( o ) ? 'stone' : 'metal' ) );

	}

	// Analyse stones (once per geometry and scale)
	const cache = new Map();
	const items = [];
	const plain = [];
	const q = new Quaternion(), pos = new Vector3(), scl = new Vector3();

	for ( const o of stones ) {

		o.userData.rel.decompose( pos, q, scl );
		const s = ( scl.x + scl.y + scl.z ) / 3;
		const uniform = scl.x > 0 && scl.y > 0 && scl.z > 0 && Math.max( scl.x, scl.y, scl.z ) - Math.min( scl.x, scl.y, scl.z ) < 1e-3 * s;
		const key = o.geometry.uuid + ( uniform ? '' : '|' + [ scl.x, scl.y, scl.z ].map( x => x.toFixed( 5 ) ).join( ',' ) );

		let rec = cache.get( key );

		if ( ! rec ) {

			let geo = o.geometry;

			if ( ! uniform ) {

				geo = geo.clone();
				geo.applyMatrix4( new Matrix4().makeScale( scl.x, scl.y, scl.z ) );

			}

			rec = analyse( geo, o.name || 'unnamed', warnings );
			cache.set( key, rec );

		}

		if ( ! rec.cut ) { plain.push( o ); continue; }

		// Planes are relative to the bounds center: put the mesh there, size = bounding radius
		const sc = uniform ? s : 1;
		const p = rec.center.clone().multiplyScalar( sc ).applyQuaternion( q ).add( pos );
		const mats = Array.isArray( o.material ) ? o.material : [ o.material ];
		items.push( { src: o, key, rec, pos: p, quat: q.clone(), scale: sc * rec.radius, kind: stoneKind( [ o.name, ...mats.map( m => m.name ) ] ) } );

	}

	// Groups by size
	const gems = [];
	const mats = { center: [], side: [], pave: [] };
	let big = 0;
	items.forEach( ( it, i ) => { if ( it.scale > items[ big ].scale ) big = i; } );
	const matCache = new Map();

	items.forEach( ( it, i ) => {

		const group = i === big ? 'center' : it.scale >= 0.3 * items[ big ].scale ? 'side' : 'pave';
		const mk = it.key + '|' + group + '|' + it.kind;
		let mat = matCache.get( mk );

		if ( ! mat ) {

			mat = new GemMaterial( it.rec.cut, STONES[ it.kind ] );
			matCache.set( mk, mat );
			mats[ group ].push( mat );

		}

		const mesh = new Mesh( it.rec.cut.geometry, mat );
		mesh.name = it.src.name;
		mesh.position.copy( it.pos ); mesh.quaternion.copy( it.quat ); mesh.scale.setScalar( it.scale );
		mesh.castShadow = false; mesh.receiveShadow = false;
		ring.add( mesh );
		it.src.parent.remove( it.src );
		const entry = { mesh, group, cut: it.rec.cut, scale: it.scale };
		if ( group === 'center' ) gems.unshift( entry ); else gems.push( entry );

	} );

	// Stones without a cut: simple transparent material
	const glassCache = new Map();

	for ( const o of plain ) {

		const src = Array.isArray( o.material ) ? o.material[ 0 ] : o.material;
		let m = glassCache.get( src );

		if ( ! m ) {

			m = new MeshPhysicalNodeMaterial( {
				color: src.color ? src.color.clone() : new Color( 0xffffff ),
				roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.3, ior: src.ior || 2.4
			} );
			glassCache.set( src, m );

		}

		o.material = m;
		o.castShadow = false; o.receiveShadow = false;

	}

	// Metal
	for ( const o of metals ) {

		if ( metal ) o.material = metal;
		o.castShadow = o.receiveShadow = true;
		o.geometry.computeBoundingSphere();
		const hullR = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius * o.userData.rel.getMaxScaleOnAxis() : 0;
		if ( hullR < 0.04 * total ) o.castShadow = false;

	}

	if ( ! gems.length ) warnings.push( 'No stone with facet planes detected' );

	for ( const o of parts ) delete o.userData.rel;
	ring.updateMatrixWorld( true );

	return { ring, gems, mats, warnings, plain, metalCount: metals.length };

}

// Bring the ring into the pose of the example ring: finger axis Z (smallest extent), head
// toward +Y (toward the largest stone), width X equal to refWidth, center of the band at the
// origin. res.ring becomes a new group without its own rotation, as layDown expects it.
export function orientModel( res, refWidth ) {

	const inner = res.ring;
	inner.position.set( 0, 0, 0 );
	inner.quaternion.identity();
	inner.scale.setScalar( 1 );
	inner.updateMatrixWorld( true );
	const outer = new Group();
	outer.name = 'Model';
	outer.add( inner );
	res.ring = outer;

	const box = new Box3().setFromObject( inner );
	if ( box.isEmpty() ) return res;
	const dim = box.getSize( new Vector3() ).toArray();
	const mid = box.getCenter( new Vector3() );
	const finger = dim.indexOf( Math.min( ...dim ) );
	const rest = [ 0, 1, 2 ].filter( i => i !== finger );
	// Without a clear hint from the stones: the own Y axis of the model (glTF is Y-up),
	// if the model lies flat, the longer axis (band plus head)
	let head = rest.includes( 1 ) ? 1 : dim[ rest[ 0 ] ] >= dim[ rest[ 1 ] ] ? rest[ 0 ] : rest[ 1 ], sign = 1;

	// Centroid of all stones by volume: the center stone pulls it toward the head, pavé on both
	// shoulders is symmetric and cancels out sideways. An eternity ring gives no direction.
	const c = new Vector3(), b = new Box3(), size = new Vector3(), at = new Vector3();
	let weight = 0;

	for ( const m of [ ...res.gems.map( g => g.mesh ), ...( res.plain || [] ) ] ) {

		b.setFromObject( m );
		if ( b.isEmpty() ) continue;
		b.getSize( size );
		const w = size.x * size.y * size.z;
		c.addScaledVector( b.getCenter( at ), w );
		weight += w;

	}

	if ( weight > 0 ) {

		const off = c.divideScalar( weight ).sub( mid ).toArray();
		const lean = i => Math.abs( off[ i ] ) / Math.max( dim[ i ], 1e-9 );
		const i = lean( rest[ 0 ] ) >= lean( rest[ 1 ] ) ? rest[ 0 ] : rest[ 1 ];
		if ( lean( i ) > 0.1 ) { head = i; sign = off[ i ] < 0 ? - 1 : 1; }

	}

	const across = rest.find( i => i !== head );
	const x = new Vector3().setComponent( across, 1 );
	const y = new Vector3().setComponent( head, sign );
	const z = new Vector3().crossVectors( x, y );
	// makeBasis maps X, Y, Z onto the model axes, the transpose rotates back
	inner.quaternion.setFromRotationMatrix( new Matrix4().makeBasis( x, y, z ).transpose() );
	inner.scale.setScalar( refWidth / Math.max( dim[ across ], 1e-9 ) );
	outer.updateMatrixWorld( true );

	b.setFromObject( outer );
	const cx = ( b.min.x + b.max.x ) / 2, cz = ( b.min.z + b.max.z ) / 2;
	// Bottom edge plus half the width: for a round ring the center of the band lies there
	inner.position.set( - cx, - ( b.min.y + ( b.max.x - b.min.x ) / 2 ), - cz );
	outer.updateMatrixWorld( true );
	return res;

}

// Short summary as text
export function describeModel( result ) {

	const g = { center: [], side: [], pave: [] };
	for ( const e of result.gems ) g[ e.group ].push( e.cut.planes.length );

	const part = ( name, list ) => {

		if ( ! list.length ) return name + ' 0';
		const lo = Math.min( ...list ), hi = Math.max( ...list );
		return name + ' ' + list.length + ' (' + ( lo === hi ? lo : lo + ' to ' + hi ) + ' planes)';

	};

	const out = [
		result.gems.length + ' stones: ' + [ part( 'Center', g.center ), part( 'Side', g.side ), part( 'Pavé', g.pave ) ].join( ', ' ),
		( result.metalCount ?? 0 ) + ' metal parts'
	];

	const n = result.plain ? result.plain.length : 0, w = result.warnings.length;
	if ( n ) out.push( n + ( n === 1 ? ' stone' : ' stones' ) + ' as plain glass only' );
	if ( w ) out.push( w + ( w === 1 ? ' warning' : ' warnings' ) );
	return out.join( ', ' );

}
