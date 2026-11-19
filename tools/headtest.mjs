// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks the prong basket without a GPU: no metal in the stone, every prong touches it,
// roots and arch feet lie in the metal, the stone does not penetrate the band.
// node --import ./tools/three-hook.mjs tools/headtest.mjs
import { Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Triangle, Vector3 } from 'three';
import { makeCut, CUTS } from '../src/gemcut.js';
import { bandSurface, topAt, BAND_DEFAULT } from '../src/band.js';
import { mountStone, cathedralArches } from '../src/head.js';

const metal = new MeshBasicMaterial();
const SINK = 0.004, TOUCH = 0.012, ABOVE = 0.004;
let errors = 0, cases = 0;
const messages = [];
const limits = { deep: Infinity, far: 0, root: Infinity, above: Infinity, tube: Infinity, tip: Infinity };

const cuts = {};
for ( const c of CUTS ) cuts[ c.id ] = makeCut( c.id );

// unique vertices and triangles per cut
const info = {};

function meshOf( id ) {

	if ( info[ id ] ) return info[ id ];
	const p = cuts[ id ].geometry.attributes.position.array, seen = new Set(), verts = [], tris = [];

	for ( let i = 0; i < p.length; i += 9 ) tris.push( new Triangle( new Vector3( p[ i ], p[ i + 1 ], p[ i + 2 ] ), new Vector3( p[ i + 3 ], p[ i + 4 ], p[ i + 5 ] ), new Vector3( p[ i + 6 ], p[ i + 7 ], p[ i + 8 ] ) ) );

	for ( let i = 0; i < p.length; i += 3 ) {

		const key = Math.round( p[ i ] * 1e4 ) + ',' + Math.round( p[ i + 1 ] * 1e4 ) + ',' + Math.round( p[ i + 2 ] * 1e4 );
		if ( ! seen.has( key ) ) { seen.add( key ); verts.push( new Vector3( p[ i ], p[ i + 1 ], p[ i + 2 ] ) ); }

	}

	return ( info[ id ] = { verts, tris } );

}

const tmp = new Vector3(), cp = new Vector3();

function sdCut( planes, q ) {

	let m = - Infinity;
	for ( const e of planes ) m = Math.max( m, e.x * q.x + e.y * q.y + e.z * q.z - e.w );
	return m;

}

function distCut( id, q ) {

	let best = Infinity;
	for ( const t of meshOf( id ).tris ) { t.closestPointToPoint( q, cp ); best = Math.min( best, cp.distanceTo( q ) ); }
	return best;

}

// Radius of the band inner surface at (a, z), null without metal
function bottomRadius( surface, a, z, samples = 24 ) {

	let best = null;

	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		let p = surface.section( a, k, side, Math.PI / 2 );

		for ( let j = 1; j <= samples; j ++ ) {

			const q = surface.section( a, k, side, Math.PI / 2 + j / samples * Math.PI / 2 );
			const lo = Math.min( p[ 2 ], q[ 2 ] ), hi = Math.max( p[ 2 ], q[ 2 ] );

			if ( z >= lo - 1e-7 && z <= hi + 1e-7 && hi - lo > 1e-9 ) {

				const s = ( z - p[ 2 ] ) / ( q[ 2 ] - p[ 2 ] ), r = Math.hypot( p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * s, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * s );
				if ( best === null || r < best ) best = r;

			}

			p = q;

		}

	}

	return best;

}

const topRadius = ( surface, a, z ) => { const h = topAt( surface, a, z ); return h ? Math.hypot( h[ 0 ], h[ 1 ] ) : null; };

function check( name, { surface, cutId, scale, angle = 0, rotate = 0, profile = 1, kind = 'claw', arches = false } ) {

	cases ++;
	const cut = cuts[ cutId ];
	const parent = new Group();
	const problems = [];
	const head = mountStone( { parent, metal, cut, scale, surface, angle, rotate, profile, kind } );
	let arch = null;
	if ( arches ) arch = cathedralArches( { parent, metal, surface, head, profile } );
	parent.updateMatrixWorld( true );

	const gemM = new Matrix4().compose( head.gemPosition, new Quaternion().setFromEuler( new Euler( 0, head.gemRotationY, 0 ) ), new Vector3( scale, scale, scale ) );
	const inv = head.holder.matrixWorld.clone().multiply( gemM ).invert();
	const H = head.holder.matrixWorld;

	// 5. no invalid values
	let nan = 0;
	const collect = ( m ) => { for ( const v of m.geometry.attributes.position.array ) if ( ! Number.isFinite( v ) ) nan ++; };
	const metals = head.holder.children.filter( o => o.isMesh );
	for ( const m of metals ) collect( m );
	if ( arch ) for ( const m of arch.meshes ) collect( m );
	if ( ! Number.isFinite( head.halfAngle + head.gemPosition.x + head.gemPosition.y + head.gemPosition.z ) || head.halfAngle <= 0 ) nan ++;
	for ( const t of head.prongTips ) if ( ! Number.isFinite( t.x + t.y + t.z ) ) nan ++;
	if ( nan ) problems.push( 'invalid values ' + nan );

	// Vertices of a mesh in cut space (cut units)
	const inCut = ( m, cb ) => {

		const p = m.geometry.attributes.position.array;
		for ( let i = 0; i < p.length; i += 3 ) {

			tmp.set( p[ i ], p[ i + 1 ], p[ i + 2 ] ).applyMatrix4( m.matrixWorld ).applyMatrix4( inv );
			cb( tmp );

		}

	};

	// 1. no metal in the stone
	let deep = Infinity;
	const all = arch ? metals.concat( arch.meshes ) : metals;
	for ( const m of all ) inCut( m, q => { deep = Math.min( deep, sdCut( cut.planes, q ) * scale ); } );
	limits.deep = Math.min( limits.deep, deep );
	if ( deep < - SINK ) problems.push( 'Metal in the stone ' + ( - deep ).toFixed(4) );

	// 2. every prong touches the stone
	head.claws.forEach( ( c, k ) => {

		let best = Infinity;

		for ( const m of c.meshes.slice( 0, - 1 ) ) inCut( m, q => {

			if ( sdCut( cut.planes, q ) * scale > TOUCH ) return;
			best = Math.min( best, distCut( cutId, q ) * scale );

		} );

		limits.far = Math.max( limits.far, best );
		if ( ! ( best <= TOUCH ) ) problems.push( 'Prong ' + k + ' does not touch (' + best.toFixed( 4 ) + ')' );

	} );

	// 2b. every prong tip rests on the crown above the girdle and touches the stone
	head.claws.forEach( ( c, k ) => {

		const tip = c.meshes[ c.meshes.length - 1 ];
		let best = Infinity;
		inCut( tip, q => { best = Math.min( best, distCut( cutId, q ) * scale ); } );
		const center = c.tip.clone().applyMatrix4( H ).applyMatrix4( inv );
		limits.tip = Math.min( limits.tip, center.y );
		if ( center.y < 0 ) problems.push( 'Tip ' + k + ' below the girdle (' + center.y.toFixed( 3 ) + ')' );
		if ( ! ( best <= TOUCH ) ) problems.push( 'Tip ' + k + ' does not touch (' + best.toFixed( 4 ) + ')' );

	} );

	// 3. roots and arch feet in the metal
	const inMetal = ( p, label ) => {

		const a = Math.atan2( p.x, p.y ), r = Math.hypot( p.x, p.y ), top = topRadius( surface, a, p.z );
		if ( top === null ) problems.push( label + ' without metal' );
		else limits.root = Math.min( limits.root, top - r );
		if ( top !== null && r > top - ABOVE ) problems.push( label + ' not below the top surface (' + ( top - r ).toFixed( 4 ) + ')' );

	};

	head.claws.forEach( ( c, k ) => inMetal( c.root.clone().applyMatrix4( H ), 'Root ' + k ) );
	// open wire end at the root: entirely inside the band body, not through bore or flank
	let remaining = Infinity;
	const ringN = scale >= 0.2 ? 15 : 13; // vertices of the open wire end: rad + 1

	head.claws.forEach( ( c, k ) => c.meshes.slice( 0, - 1 ).forEach( m => {

		const p = m.geometry.attributes.position.array;

		for ( let i = 0; i < 3 * ringN; i += 3 ) {

			tmp.set( p[ i ], p[ i + 1 ], p[ i + 2 ] ).applyMatrix4( m.matrixWorld );
			const a = Math.atan2( tmp.x, tmp.y ), r = Math.hypot( tmp.x, tmp.y ), top = topRadius( surface, a, tmp.z ), bot = bottomRadius( surface, a, tmp.z );
			if ( top === null || bot === null ) { problems.push( 'Root tube ' + k + ' outside the flank' ); return; }
			remaining = Math.min( remaining, r - bot );
			if ( r < bot + 0.002 ) { problems.push( 'Root tube ' + k + ' through the bore (' + ( r - bot ).toFixed( 4 ) + ')' ); return; }

		}

	} ) );

	limits.tube = Math.min( limits.tube, remaining );

	if ( arch ) arch.feet.forEach( ( f, k ) => inMetal( f, 'Arch foot ' + k ) );

	// Arch ends lie on the lower gallery
	if ( arch ) arch.ends.forEach( ( e, k ) => {

		const d = Math.min( ...head.gallery[ 0 ].pts.map( p => p.clone().applyMatrix4( head.holder.matrix ).distanceTo( e ) ) );
		if ( d > 1e-5 ) problems.push( 'Arch end ' + k + ' not on the gallery' );

	} );

	// 4. the stone lies above the band
	let clear = Infinity, clearA = 0;

	for ( const v of meshOf( cutId ).verts ) {

		tmp.copy( v ).applyMatrix4( head.holder.matrixWorld.clone().multiply( gemM ) );
		const a = Math.atan2( tmp.x, tmp.y ), top = topRadius( surface, a, tmp.z );
		if ( top === null ) continue;
		const h = Math.hypot( tmp.x, tmp.y ) - top;
		if ( h < clear ) { clear = h; clearA = a; }

	}

	limits.above = Math.min( limits.above, clear );
	if ( clear < ABOVE ) problems.push( 'Stone in the band (' + clear.toFixed( 4 ) + ' at a=' + clearA.toFixed( 2 ) + ')' );

	if ( problems.length ) {

		errors ++;
		if ( messages.length < 60 ) messages.push( 'FAIL ' + name + ': ' + problems.join( '; ' ) );

	}

}

// ---- Cases ----

const BANDS = {
	'solitaire/round': () => bandSurface( 'solitaire', BAND_DEFAULT ),
	'solitaire/knife': () => bandSurface( 'solitaire', { ...BAND_DEFAULT, shape: 'knife' } ),
	'split/divided': () => bandSurface( 'split', { ...BAND_DEFAULT, shoulders: 'split' } ),
	'bypass': () => bandSurface( 'bypass', BAND_DEFAULT ),
	'wishbone': () => bandSurface( 'wishbone', BAND_DEFAULT ),
	'dome/5.6': () => bandSurface( 'dome', { ...BAND_DEFAULT, front: 5.6 } )
};

const t0 = Date.now();

for ( const [ bn, mk ] of Object.entries( BANDS ) ) {

	const surface = mk();

	for ( const c of CUTS ) for ( const scale of [ 0.25, 0.4, 0.6 ] ) for ( const profile of [ 0.85, 1, 1.25 ] )
		check( [ bn, c.id, scale, profile ].join( ' ' ), { surface, cutId: c.id, scale, profile } );

}

// Side stones
for ( const bn of [ 'solitaire/round', 'split/divided', 'dome/5.6' ] ) {

	const surface = BANDS[ bn ]();

	for ( const id of [ 'brilliant', 'emerald', 'pear', 'trillion' ] ) for ( const scale of [ 0.12, 0.2 ] ) for ( const angle of [ - 0.42, 0.42 ] )
		check( [ 'Side', bn, id, scale, angle ].join( ' ' ), { surface, cutId: id, scale, angle, rotate: 0 } );

}

// East-west, petal prongs, cathedral arches
for ( const bn of [ 'solitaire/round', 'dome/5.6', 'wishbone' ] ) {

	const surface = BANDS[ bn ]();

	for ( const id of [ 'oval', 'marquise', 'emerald', 'pear', 'kite' ] ) for ( const scale of [ 0.25, 0.4 ] )
		check( [ 'EW', bn, id, scale ].join( ' ' ), { surface, cutId: id, scale, rotate: Math.PI / 2 } );

	for ( const id of [ 'brilliant', 'oval', 'cushion', 'old-european', 'hexagon', 'rose' ] ) for ( const scale of [ 0.25, 0.4, 0.6 ] )
		check( [ 'Petal', bn, id, scale ].join( ' ' ), { surface, cutId: id, scale, kind: 'petal' } );

}

for ( const style of [ 'cathedral', 'solitaire' ] ) for ( const shape of [ 'round', 'knife' ] ) {

	const surface = bandSurface( style, { ...BAND_DEFAULT, shape } );

	for ( const id of [ 'brilliant', 'oval', 'emerald', 'pear', 'cushion' ] ) for ( const scale of [ 0.25, 0.4, 0.6 ] ) for ( const profile of [ 0.85, 1.25 ] )
		check( [ 'Arches', style, shape, id, scale, profile ].join( ' ' ), { surface, cutId: id, scale, profile, arches: true } );

}

for ( const m of messages ) console.log( m );
console.log( 'Limits: deepest metal point in the stone', ( - limits.deep ).toFixed( 4 ), '(max ' + SINK + '), farthest prong', limits.far.toFixed( 4 ), '(max ' + TOUCH + '), shallowest root', limits.root.toFixed( 4 ), '(min ' + ABOVE + '), stone above band', limits.above.toFixed( 4 ), '(min ' + ABOVE + '), root tube above bore', limits.tube.toFixed( 4 ), '(min 0.002), lowest tip', limits.tip.toFixed( 3 ), '(min 0)' );
console.log( cases + ' cases in ' + ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) + ' s, ' + ( errors ? errors + ' errors' : 'basket: all passed' ) );
process.exitCode = errors ? 1 : 0;
