// SPDX-License-Identifier: AGPL-3.0-or-later
// Cuts as plane sets. A stone is the intersection of half-spaces n·x <= d.
// The mesh (flat facets) and the data for the shader both come from the same planes.
import { BufferGeometry, Float32BufferAttribute, Vector3, Vector4 } from 'three';

const RAD = Math.PI / 180;

function plane( nx, ny, nz, px, py, pz ) {

	const n = new Vector3( nx, ny, nz ).normalize();
	return new Vector4( n.x, n.y, n.z, n.x * px + n.y * py + n.z * pz );

}

// Round brilliant, girdle radius 1, table toward +Y.
export function brilliantPlanes( o = {} ) {

	const { table = 0.56, crownAngle = 34.5, pavilionAngle = 40.9, girdle = 0.035, girdleSides = 16, starLen = 0.5, lowerHalf = 0.77 } = o;
	const P = [];
	const g = girdle;
	const cA = crownAngle * RAD, pA = pavilionAngle * RAD;
	const h = ( 1 - table ) * Math.tan( cA ) + g; // table height

	// Angles from star length and length of the lower half facets: star, two main facets
	// and two girdle facets meet in one point
	const c22 = Math.cos( 22.5 * RAD ), c11 = Math.cos( 11.25 * RAD ), rt = table * c22;
	const rS = table + starLen * ( 1 - table ), yS = g + ( 1 - rS * c22 ) * Math.tan( cA );
	const sA = Math.atan( ( h - yS ) / ( rS - rt ) );
	const uA = Math.atan( ( yS - g ) / ( 1 - rS * c11 ) );
	const rL = 1 - lowerHalf, lA = Math.atan( Math.tan( pA ) * ( 1 - rL * c22 ) / ( 1 - rL * c11 ) );

	P.push( plane( 0, 1, 0, 0, h, 0 ) );

	for ( let k = 0; k < 8; k ++ ) {

		const a = k * 45 * RAD, c = Math.cos( a ), s = Math.sin( a );
		// crown main facets
		P.push( plane( c * Math.sin( cA ), Math.cos( cA ), s * Math.sin( cA ), c, g, s ) );
		// pavilion main facets
		P.push( plane( c * Math.sin( pA ), - Math.cos( pA ), s * Math.sin( pA ), c, - g, s ) );
		// star facets at the table edges
		const a2 = a + 22.5 * RAD, c2 = Math.cos( a2 ), s2 = Math.sin( a2 );
		P.push( plane( c2 * Math.sin( sA ), Math.cos( sA ), s2 * Math.sin( sA ), c2 * rt, h, s2 * rt ) );

	}

	for ( let k = 0; k < 16; k ++ ) {

		const a = ( 11.25 + k * 22.5 ) * RAD, c = Math.cos( a ), s = Math.sin( a );
		P.push( plane( c * Math.sin( uA ), Math.cos( uA ), s * Math.sin( uA ), c, g, s ) ); // upper girdle facets
		P.push( plane( c * Math.sin( lA ), - Math.cos( lA ), s * Math.sin( lA ), c, - g, s ) ); // lower girdle facets

	}

	for ( let k = 0; k < girdleSides; k ++ ) {

		const a = ( k + 0.5 ) * ( 360 / girdleSides ) * RAD;
		P.push( plane( Math.cos( a ), 0, Math.sin( a ), Math.cos( a ), 0, Math.sin( a ) ) );

	}

	return P;

}

// Height of the crown at inset t: step i rises from its inset to the next with
// tan(angle), the last one up to the table.
function crownHeight( crown, g, t ) {

	let y = g;

	for ( let i = 0; i < crown.length; i ++ ) {

		const [ ang, ins ] = crown[ i ];
		const next = i + 1 < crown.length ? crown[ i + 1 ][ 1 ] : Infinity;
		const slope = Math.tan( ang * RAD );
		if ( t <= next ) return y + Math.max( t - ins, 0 ) * slope;
		y += ( next - ins ) * slope;

	}

	return y;

}

// Edge of an outline in the base plane: normal (nx, nz), distance d from the Y axis.
// corner marks truncated corners.
const edge = ( nx, nz, d, corner = false ) => ( { nx, nz, d, corner } );
const edgeAt = ( deg, d, corner = false ) => edge( Math.cos( deg * RAD ), Math.sin( deg * RAD ), d, corner );

// Rectangle with half width hx in X and half length hz in Z, optionally with corner bevels
// (corner: length of the truncated legs)
function rectEdges( hx, hz, corner = null ) {

	const E = [ edge( 1, 0, hx ), edge( - 1, 0, hx ), edge( 0, 1, hz ), edge( 0, - 1, hz ) ];
	if ( corner === null ) return E;
	const k = Math.SQRT1_2, cd = ( hx + hz - corner * 2 ) * k; // distance of the corner plane

	for ( const [ x, z ] of [ [ k, k ], [ - k, k ], [ k, - k ], [ - k, - k ] ] ) E.push( edge( x, z, cd, true ) );

	return E;

}

// Edges of a convex polygon from vertices [x, z]; the Y axis lies inside
function polyEdges( pts ) {

	return pts.map( ( a, i ) => {

		const b = pts[ ( i + 1 ) % pts.length ];
		const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], l = Math.hypot( dx, dz );
		let nx = dz / l, nz = - dx / l, d = nx * a[ 0 ] + nz * a[ 1 ];
		if ( d < 0 ) { nx = - nx; nz = - nz; d = - d; }
		return edge( nx, nz, d );

	} );

}

const verticalPlane = ( e ) => plane( e.nx, 0, e.nz, e.nx * e.d, 0, e.nz * e.d );

// Step cut for any convex outline. Each edge carries girdle, crown and pavilion steps.
// inset: inset of the table from all edges, the table height follows from it: the table sits
// where the crown steps arrive at this inset. unit stretches the step insets.
function stepPlanes( edges, o ) {

	const { girdle, inset, unit = 1 } = o;
	const crown = o.crown.map( ( [ a, i ] ) => [ a, i * unit ] );
	const pav = o.pavilion.map( ( [ a, i ] ) => [ a, i * unit ] );
	const g = girdle;
	const P = [];

	P.push( plane( 0, 1, 0, 0, crownHeight( crown, g, inset * unit ), 0 ) );

	for ( const { nx, nz, d: dist, corner } of edges ) {

		const pavilion = corner && o.cornerPavilion ? pav.slice( 0, o.cornerPavilion ) : pav; // truncated corners run out earlier

		P.push( plane( nx, 0, nz, nx * dist, 0, nz * dist ) );

		let y = g, ins = 0;

		for ( let i = 0; i < crown.length; i ++ ) {

			const [ ang, is ] = crown[ i ];
			if ( i > 0 ) { y += ( is - ins ) * Math.tan( crown[ i - 1 ][ 0 ] * RAD ); ins = is; }
			const a = ang * RAD;
			P.push( plane( nx * Math.sin( a ), Math.cos( a ), nz * Math.sin( a ), nx * ( dist - ins ), y, nz * ( dist - ins ) ) );

		}

		y = - g; ins = 0;

		for ( let i = 0; i < pavilion.length; i ++ ) {

			const [ ang, is ] = pavilion[ i ];
			if ( i > 0 ) { y -= ( is - ins ) * Math.tan( pavilion[ i - 1 ][ 0 ] * RAD ); ins = is; }
			const a = ang * RAD;
			P.push( plane( nx * Math.sin( a ), - Math.cos( a ), nz * Math.sin( a ), nx * ( dist - ins ), y, nz * ( dist - ins ) ) );

		}

	}

	return P;

}

const EMERALD_CROWN = [ [ 58, 0 ], [ 42, 0.13 ], [ 28, 0.24 ] ]; // angle, inset
const EMERALD_PAVILION = [ [ 62, 0 ], [ 47, 0.2 ], [ 33, 0.42 ] ];

// Step cut (emerald cut) with beveled corners. Half width 1 in X.
export function emeraldPlanes( o = {} ) {

	// table: table width as a fraction of the stone width
	const { ratio = 1.38, girdle = 0.04, corner = 0.28, table = 0.72 } = o;

	return stepPlanes( rectEdges( 1, ratio, corner ), {
		girdle, inset: 1 * ( 1 - table ), crown: o.crown || EMERALD_CROWN, pavilion: o.pavilion || EMERALD_PAVILION
	} );

}

// Stretch unevenly (oval, marquise): x' = S x  =>  n' = S^-1 n, d' = d / |S^-1 n|
export function scalePlanes( planes, sx, sy, sz ) {

	return planes.map( p => {

		const n = new Vector3( p.x / sx, p.y / sy, p.z / sz );
		const l = n.length();
		return new Vector4( n.x / l, n.y / l, n.z / l, p.w / l );

	} );

}

function clip( poly, p ) {

	const out = [];

	for ( let i = 0; i < poly.length; i ++ ) {

		const a = poly[ i ], b = poly[ ( i + 1 ) % poly.length ];
		const da = a.x * p.x + a.y * p.y + a.z * p.z - p.w;
		const db = b.x * p.x + b.y * p.y + b.z * p.z - p.w;
		if ( da <= 0 ) out.push( a );
		if ( ( da < 0 && db > 0 ) || ( da > 0 && db < 0 ) ) out.push( a.clone().lerp( b, da / ( da - db ) ) );

	}

	return out;

}

// Mesh from the planes. Returns the geometry, the planes that are actually visible and the bounding radius.
export function buildGem( planes ) {

	const pos = [], nor = [], used = [];
	let radius = 0, minY = 0, maxY = 0;

	for ( let i = 0; i < planes.length; i ++ ) {

		const p = planes[ i ];
		const n = new Vector3( p.x, p.y, p.z );
		const u = new Vector3( 1, 0, 0 );
		if ( Math.abs( n.x ) > 0.9 ) u.set( 0, 1, 0 );
		u.cross( n ).normalize();
		const v = new Vector3().crossVectors( n, u );
		const c = n.clone().multiplyScalar( p.w );
		const B = 50;
		let poly = [ [ - B, - B ], [ B, - B ], [ B, B ], [ - B, B ] ].map( ( [ a, b ] ) => c.clone().addScaledVector( u, a ).addScaledVector( v, b ) );

		for ( let j = 0; j < planes.length && poly.length >= 3; j ++ ) if ( j !== i ) poly = clip( poly, planes[ j ] );

		// remove coincident points
		poly = poly.filter( ( q, k ) => q.distanceTo( poly[ ( k + 1 ) % poly.length ] ) > 1e-6 );
		if ( poly.length < 3 ) continue;

		used.push( p );

		for ( let k = 1; k < poly.length - 1; k ++ ) {

			const tri = [ poly[ 0 ], poly[ k ], poly[ k + 1 ] ];
			const e = new Vector3().subVectors( tri[ 1 ], tri[ 0 ] ).cross( new Vector3().subVectors( tri[ 2 ], tri[ 0 ] ) );
			if ( e.dot( n ) < 0 ) tri.reverse();

			for ( const q of tri ) {

				pos.push( q.x, q.y, q.z ); nor.push( n.x, n.y, n.z );
				radius = Math.max( radius, q.length() );
				minY = Math.min( minY, q.y ); maxY = Math.max( maxY, q.y );

			}

		}

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	geometry.setAttribute( 'normal', new Float32BufferAttribute( nor, 3 ) );
	geometry.computeBoundingSphere();
	geometry.computeBoundingBox();

	return { geometry, planes: used, radius, minY, maxY };

}

export const MAX_PLANES = 96;

// Keep only the planes that carry a facet (trimming planes hide parts of the girdle)
function liveOnly( P ) {

	const used = new Set( buildGem( P ).planes );
	return P.filter( p => used.has( p ) );

}

// Pointed ends: two vertical planes with half angle theta (degrees) to the Z axis meet in
// (0, 0, z). dir = +1 for the end at +Z, -1 at -Z.
function tipPlanes( z, theta, dir ) {

	const t = theta * RAD;
	return [ - 1, 1 ].map( s => plane( s * Math.cos( t ), 0, dir * Math.sin( t ), 0, 0, z * dir ) );

}

// Crown and pavilion of a stretched brilliant, the outline comes from vertical planes
function clippedBrilliant( base, scale, edges ) {

	return liveOnly( [ ...scalePlanes( base, ...scale ), ...edges.map( verticalPlane ) ] );

}

// Culet: small horizontal plane at the pavilion tip
const culet = ( y ) => plane( 0, - 1, 0, 0, - y, 0 );
const OLD = { table: 0.45, crownAngle: 40, pavilionAngle: 44, girdle: 0.05, girdleSides: 32 };
const oldTip = ( o ) => ( Math.tan( o.pavilionAngle * RAD ) + o.girdle ) * 0.9;

// Rose cut: flat bottom, dome of triangles in three rings (6, 6, 12)
function rosePlanes( o = {} ) {

	const { height = 0.6, floor = 0.05 } = o;
	const P = [ plane( 0, - 1, 0, 0, - floor, 0 ) ];

	const ring = ( n, a0, slope, r, y ) => {

		const s = Math.sin( slope * RAD ), c = Math.cos( slope * RAD );

		for ( let k = 0; k < n; k ++ ) {

			const a = ( a0 + k * 360 / n ) * RAD;
			P.push( plane( Math.cos( a ) * s, c, Math.sin( a ) * s, Math.cos( a ) * r, y, Math.sin( a ) * r ) );

		}

	};

	const y2 = ( 1 - 0.62 ) * Math.tan( 40 * RAD );
	ring( 6, 30, 20, 0, height );
	ring( 6, 0, 30, 0.62, y2 );
	ring( 12, 15, 40, 1, 0 );

	for ( let k = 0; k < 24; k ++ ) {

		const a = ( k + 0.5 ) * 15 * RAD;
		P.push( plane( Math.cos( a ), 0, Math.sin( a ), Math.cos( a ), 0, Math.sin( a ) ) );

	}

	return P;

}

const ASSCHER = { corner: 0.4, girdle: 0.04, inset: 0.4, crown: [ [ 62, 0 ], [ 55, 0.1 ], [ 48, 0.2 ] ], pavilion: [ [ 60, 0 ], [ 50, 0.2 ], [ 40, 0.4 ] ] };
const PRINCESS = { girdle: 0.04, inset: 0.32, crown: [ [ 34.5, 0 ] ], pavilion: [ [ 64, 0 ], [ 52, 0.2 ], [ 40, 0.45 ] ] };
const STEPS = { girdle: 0.04, crown: EMERALD_CROWN, pavilion: EMERALD_PAVILION };
const TRILLION_U = Math.sqrt( 3 ) / 2; // inradius, so that the half width in X is 1
const KITE_TIP = 2.4, KITE_TAIL = 1.0;
const CUSHION_R = 1.2, OLD_MINE_R = 1.26;
const RADIANT = { hz: 1.25, corner: 0.28, r: 1.18 };

// Outline edges of the cuts that are built from edges (step cuts and radiant)
function outlineEdges( kind ) {

	switch ( kind ) {

		case 'emerald': return rectEdges( 1, 1.38, 0.28 );
		case 'asscher': return rectEdges( 1, 1, ASSCHER.corner );
		case 'princess': return rectEdges( 1, 1 );
		case 'baguette': return rectEdges( 1, 2.5 );
		case 'radiant': return rectEdges( 1, RADIANT.hz, RADIANT.corner );
		case 'hexagon': return [ 0, 60, 120, 180, 240, 300 ].map( a => edgeAt( a, 1 ) );
		case 'kite': return polyEdges( [ [ 1, 0 ], [ 0, KITE_TIP ], [ - 1, 0 ], [ 0, - KITE_TAIL ] ] );
		case 'trillion': {

			const u = TRILLION_U, cut = 0.35 * u;
			return [ ...[ 270, 30, 150 ].map( a => edgeAt( a, u ) ), ...[ 90, 210, 330 ].map( a => edgeAt( a, 2 * u - cut, true ) ) ];

		}

	}

	return null;

}

// All planes of a cut before the mesh is built (without opts.scale)
export function cutPlanes( kind, opts = {} ) {

	switch ( kind ) {

		case 'emerald': return emeraldPlanes( opts );

		case 'oval': return scalePlanes( brilliantPlanes( { girdleSides: 32, ...opts } ), 1, 1, 1.35 );

		case 'marquise': return liveOnly( [ ...scalePlanes( brilliantPlanes( { girdleSides: 24, ...opts } ), 1, 1, 2 ), ...tipPlanes( 2, 36, 1 ), ...tipPlanes( 2, 36, - 1 ) ] );

		case 'pear': return liveOnly( [ ...scalePlanes( brilliantPlanes( { girdleSides: 24, ...opts } ), 1, 1, 1.5 ), ...tipPlanes( 1.5, 35, 1 ) ] );

		case 'cushion': return clippedBrilliant( brilliantPlanes( { girdleSides: 32, ...opts } ), [ CUSHION_R, CUSHION_R, CUSHION_R ], rectEdges( 1, 1 ) );

		case 'princess': {

			const P = stepPlanes( outlineEdges( kind ), { ...PRINCESS, ...opts } );
			const k = Math.SQRT1_2, b = 22 * RAD, g = PRINCESS.girdle;
			// corner facets of the crown
			for ( const [ x, z ] of [ [ 1, 1 ], [ - 1, 1 ], [ 1, - 1 ], [ - 1, - 1 ] ] ) P.push( plane( x * k * Math.sin( b ), Math.cos( b ), z * k * Math.sin( b ), x, g, z ) );
			return P;

		}

		case 'asscher': return stepPlanes( outlineEdges( kind ), { ...ASSCHER, ...opts } );

		case 'radiant': return clippedBrilliant( brilliantPlanes( opts ), [ RADIANT.r, RADIANT.r, RADIANT.r * RADIANT.hz ], outlineEdges( kind ) );

		case 'baguette': return stepPlanes( outlineEdges( kind ), { ...STEPS, inset: 0.38, ...opts } );

		case 'trillion': return stepPlanes( outlineEdges( kind ), { ...STEPS, inset: 0.28, unit: TRILLION_U, cornerPavilion: 2, ...opts } );

		case 'old-european': {

			const o = { ...OLD, ...opts };
			return [ ...brilliantPlanes( o ), culet( oldTip( o ) ) ];

		}

		case 'old-mine': {

			const o = { ...OLD, ...opts }, R = OLD_MINE_R;
			return [ ...clippedBrilliant( brilliantPlanes( o ), [ R, R, R ], rectEdges( 1, 1 ) ), culet( oldTip( o ) * R ) ];

		}

		case 'rose': return rosePlanes( opts );

		case 'hexagon': return stepPlanes( outlineEdges( kind ), { ...STEPS, inset: 0.3, ...opts } );

		case 'kite': return stepPlanes( outlineEdges( kind ), { ...STEPS, inset: 0.3, ...opts } );

	}

	return brilliantPlanes( opts );

}

export const CUTS = [
	{ id: 'brilliant', name: 'Brilliant' },
	{ id: 'oval', name: 'Oval' },
	{ id: 'marquise', name: 'Marquise' },
	{ id: 'pear', name: 'Pear' },
	{ id: 'cushion', name: 'Cushion' },
	{ id: 'princess', name: 'Princess' },
	{ id: 'emerald', name: 'Emerald' },
	{ id: 'asscher', name: 'Asscher' },
	{ id: 'radiant', name: 'Radiant' },
	{ id: 'baguette', name: 'Baguette' },
	{ id: 'trillion', name: 'Trillion' },
	{ id: 'old-european', name: 'Old European' },
	{ id: 'old-mine', name: 'Old mine' },
	{ id: 'rose', name: 'Rose' },
	{ id: 'hexagon', name: 'Hexagon' },
	{ id: 'kite', name: 'Kite' }
];

export function makeCut( kind, opts = {} ) {

	let planes = cutPlanes( kind, opts );
	if ( opts.scale ) planes = scalePlanes( planes, ...opts.scale );
	const gem = buildGem( planes );
	if ( gem.planes.length > MAX_PLANES ) throw new Error( 'too many facets: ' + gem.planes.length );
	gem.kind = CUTS.some( c => c.id === kind ) ? kind : 'brilliant';
	return gem;

}

// Distance of the stone surface from the Y axis in direction (cos phi, 0, sin phi) at height y
export function supportRadius( planes, phi, y ) {

	const c = Math.cos( phi ), s = Math.sin( phi );
	let r = Infinity;

	for ( const p of planes ) {

		const h = p.x * c + p.z * s;
		if ( h > 1e-6 ) r = Math.min( r, ( p.w - p.y * y ) / h );

	}

	return r;

}

// Volume of the mesh (divergence theorem over the triangles), in cut units cubed
export function cutVolume( cut ) {

	const p = cut.geometry.attributes.position.array;
	let v = 0;

	for ( let i = 0; i < p.length; i += 9 ) {

		v += p[ i ] * ( p[ i + 4 ] * p[ i + 8 ] - p[ i + 5 ] * p[ i + 7 ] )
			- p[ i + 1 ] * ( p[ i + 3 ] * p[ i + 8 ] - p[ i + 5 ] * p[ i + 6 ] )
			+ p[ i + 2 ] * ( p[ i + 3 ] * p[ i + 7 ] - p[ i + 4 ] * p[ i + 6 ] );

	}

	return v / 6;

}

// Outline at height y = 0 as a polygon of Vector3 (y = 0)
function outline( planes ) {

	let poly = [ [ - 50, - 50 ], [ 50, - 50 ], [ 50, 50 ], [ - 50, 50 ] ].map( ( [ x, z ] ) => new Vector3( x, 0, z ) );
	for ( const p of planes ) poly = clip( poly, p );
	return poly.filter( ( q, k ) => q.distanceTo( poly[ ( k + 1 ) % poly.length ] ) > 1e-6 );

}

const ang = ( x, z ) => ( Math.atan2( z, x ) + 2 * Math.PI ) % ( 2 * Math.PI );
const FIXED = {
	brilliant: [ 45, 135, 225, 315 ], oval: [ 45, 135, 225, 315 ], 'old-european': [ 45, 135, 225, 315 ],
	marquise: [ 90, 270, 0, 180 ], pear: [ 90, 215, 270, 325 ], rose: [ 30, 90, 150, 210, 270, 330 ]
};

// Prong directions as angle phi (radians), direction (cos phi, 0, sin phi)
export function prongDirs( id ) {

	if ( FIXED[ id ] ) return FIXED[ id ].map( a => a * RAD );

	const poly = outline( cutPlanes( id ) );
	const edges = outlineEdges( id );

	// middle of the corner bevels
	if ( edges && edges.some( e => e.corner ) ) {

		return edges.filter( e => e.corner ).map( e => {

			const on = poly.filter( q => Math.abs( e.nx * q.x + e.nz * q.z - e.d ) < 1e-5 );
			const m = on.reduce( ( s, q ) => s.add( q ), new Vector3() ).divideScalar( on.length );
			return ang( m.x, m.z );

		} ).sort( ( a, b ) => a - b );

	}

	// sharp corners
	if ( edges ) return poly.map( q => ang( q.x, q.z ) ).sort( ( a, b ) => a - b );

	// rounded corners (cushion): the farthest outline point per quadrant
	const out = [];

	for ( let q = 0; q < 4; q ++ ) {

		const inQ = poly.filter( p => Math.floor( ang( p.x, p.z ) / ( Math.PI / 2 ) ) === q );
		const far = Math.max( ...inQ.map( p => p.length() ) );
		const best = inQ.filter( p => p.length() > far - 1e-4 );
		out.push( best.reduce( ( s, p ) => s + ang( p.x, p.z ), 0 ) / best.length );

	}

	return out;

}
