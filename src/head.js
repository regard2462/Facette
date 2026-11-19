// SPDX-License-Identifier: AGPL-3.0-or-later
// General prong head: mounts each of the 16 cuts in any size on any band shape.
// The prongs grow out of the band, rise steeply and then follow the pavilion at a fixed distance
// up to the girdle, and reach over the crown at the top. One or two galleries run through the prongs,
// for the flat back of the rose cut one under the stone.
// Layout as in ring.js: holder rotated about Z, stone in the holder at +Y, ring axis Z.
import { CatmullRomCurve3, Group, Mesh, SphereGeometry, Triangle, Vector3 } from 'three';
import { wire } from './wire.js';
import { supportRadius, prongDirs } from './gemcut.js';
import { topAt } from './band.js';

const RAD = Math.PI / 180, TAU = Math.PI * 2;
const clamp = ( v, a, b ) => Math.min( b, Math.max( a, v ) );
const HEAD_GEO = new SphereGeometry( 1, 24, 14 );
// 26 directions for sphere probes: axes, edge midpoints and space diagonals
const DIRS = [];
for ( const x of [ - 1, 0, 1 ] ) for ( const y of [ - 1, 0, 1 ] ) for ( const z of [ - 1, 0, 1 ] ) {

	const l = Math.hypot( x, y, z );
	if ( l > 0 ) DIRS.push( [ x / l, y / l, z / l ] );

}

// ---- Band ----

// Metal spans in z at angle a (ring system), merged: [ [ lo, hi ], ... ]
function spansAt( surface, a ) {

	const iv = [];

	for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

		const z0 = surface.section( a, k, side, 0 )[ 2 ], z1 = surface.section( a, k, side, Math.PI / 2 )[ 2 ];
		iv.push( [ Math.min( z0, z1 ), Math.max( z0, z1 ) ] );

	}

	iv.sort( ( p, q ) => p[ 0 ] - q[ 0 ] );
	const out = [];

	for ( const s of iv ) {

		const last = out[ out.length - 1 ];
		if ( last && s[ 0 ] <= last[ 1 ] + 1e-4 ) last[ 1 ] = Math.max( last[ 1 ], s[ 1 ] );
		else out.push( [ s[ 0 ], s[ 1 ] ] );

	}

	return out;

}

// Radius of the band top at (a, z), null without metal
function topRad( surface, a, z ) {

	const h = topAt( surface, a, z );
	return h ? Math.hypot( h[ 0 ], h[ 1 ] ) : null;

}

// Band as seen from the holder at angle alpha: x tangential, y up, z axial
function makeBand( surface, alpha ) {

	const sp = spansAt( surface, alpha );
	const lo = Math.min( ...sp.map( s => s[ 0 ] ) ), hi = Math.max( ...sp.map( s => s[ 1 ] ) );
	let zc = ( lo + hi ) / 2;
	if ( Math.abs( zc ) < 1e-4 ) zc = 0;
	let R0 = topRad( surface, alpha, zc );

	if ( R0 === null ) {

		// Center in an opening: take the nearest span
		const s = sp.reduce( ( b, q ) => Math.abs( ( q[ 0 ] + q[ 1 ] ) / 2 - zc ) < Math.abs( ( b[ 0 ] + b[ 1 ] ) / 2 - zc ) ? q : b );
		zc = ( s[ 0 ] + s[ 1 ] ) / 2;
		R0 = topRad( surface, alpha, zc );

	}

	// Top (y in the holder) at tangential position x and axial position z
	const topY = ( x, z ) => {

		let a = alpha + Math.asin( clamp( x / R0, - 0.99, 0.99 ) ), r = null;

		for ( let i = 0; i < 3; i ++ ) {

			r = topRad( surface, a, z );
			if ( r === null ) return null;
			a = alpha + Math.asin( clamp( x / r, - 0.99, 0.99 ) );

		}

		return Math.sqrt( Math.max( 0, r * r - x * x ) );

	};

	// Radius of the band inside at (a, z), null without metal
	const botRad = ( a, z ) => {

		let best = null;

		for ( let k = 0; k < surface.strands; k ++ ) for ( const side of [ - 1, 1 ] ) {

			let p = surface.section( a, k, side, Math.PI / 2 );

			for ( let j = 1; j <= 24; j ++ ) {

				const q = surface.section( a, k, side, Math.PI / 2 + j / 24 * Math.PI / 2 );
				const lo = Math.min( p[ 2 ], q[ 2 ] ), hi = Math.max( p[ 2 ], q[ 2 ] );

				if ( z >= lo - 1e-7 && z <= hi + 1e-7 && hi - lo > 1e-9 ) {

					const u = ( z - p[ 2 ] ) / ( q[ 2 ] - p[ 2 ] ), r = Math.hypot( p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * u, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * u );
					if ( best === null || r < best ) best = r;

				}

				p = q;

			}

		}

		return best;

	};

	// Room for a wire at (xT, zT): largest radius r <= want that fits in the band body,
	// with position (a, z) and top. The wire lies in the span nearest to zT.
	const rootFor = ( xT, zT, want ) => {

		const a = alpha + Math.asin( clamp( xT / R0, - 0.99, 0.99 ) );
		const spans = spansAt( surface, a );
		let best = spans[ 0 ], bd = Infinity;

		for ( const s of spans ) {

			const d = zT < s[ 0 ] ? s[ 0 ] - zT : zT > s[ 1 ] ? zT - s[ 1 ] : 0;
			if ( d < bd ) { bd = d; best = s; }

		}

		const hw = ( best[ 1 ] - best[ 0 ] ) / 2, mid = ( best[ 0 ] + best[ 1 ] ) / 2;

		// Sphere of radius r flush below the top: all points in the metal, none below the bore
		const fits = ( r, z ) => {

			const t0 = topRad( surface, a, z );
			if ( t0 === null ) return false;
			const cr = t0 - r;

			for ( const [ xo, yo, zo ] of DIRS ) {

				const aa = a + xo * r / R0, zz = z + zo * r, t = topRad( surface, aa, zz ), b = botRad( aa, zz );
				if ( t === null || b === null || cr + yo * r < b + 0.003 ) return false;

			}

			return true;

		};

		let r = want, z = mid;

		for ( let i = 0; i < 30; i ++ ) {

			const e = r + 0.004;
			z = hw > e ? clamp( zT, best[ 0 ] + e, best[ 1 ] - e ) : mid;
			if ( fits( r, z ) || r <= 0.008 ) break;
			r = Math.max( 0.008, r * 0.93 );

		}

		return { r, a, z, top: topRad( surface, a, z ) };

	};

	// Root point: flush below the top, the center lies depth below
	const rootPoint = ( info, depth ) => {

		const r = info.top - depth;
		return new Vector3( r * Math.sin( info.a - alpha ), r * Math.cos( info.a - alpha ), info.z );

	};

	return { zc, R0, topY, rootFor, rootPoint };

}

// ---- Stone ----

const MESH = new WeakMap();

// Triangles and unique vertices of the cut (cut units)
function meshData( cut ) {

	let d = MESH.get( cut );
	if ( d ) return d;

	const pos = cut.geometry.attributes.position.array, ix = cut.geometry.index ? cut.geometry.index.array : null;
	const n = ix ? ix.length : pos.length / 3;
	const P = ( i ) => { const k = ( ix ? ix[ i ] : i ) * 3; return new Vector3( pos[ k ], pos[ k + 1 ], pos[ k + 2 ] ); };
	const tris = [], seen = new Map(), verts = [];

	for ( let i = 0; i < n; i += 3 ) {

		const t = new Triangle( P( i ), P( i + 1 ), P( i + 2 ) );
		const nr = t.getNormal( new Vector3() );
		tris.push( { t, nx: nr.x, ny: nr.y, nz: nr.z, w: nr.dot( t.a ) } );

	}

	for ( let i = 0; i < n; i ++ ) {

		const v = P( i ), key = Math.round( v.x * 1e4 ) + ',' + Math.round( v.y * 1e4 ) + ',' + Math.round( v.z * 1e4 );
		if ( ! seen.has( key ) ) { seen.set( key, 1 ); verts.push( v ); }

	}

	d = { tris, verts };
	MESH.set( cut, d );
	return d;

}

// Stone in the holder: distances and conversion between holder and cut coordinates
function makeStone( cut, scale, rotate, pos ) {

	const c = Math.cos( rotate ), s = Math.sin( rotate ), planes = cut.planes, { tris } = meshData( cut );
	const p = new Vector3(), q = new Vector3();

	const sdCut = ( x, y, z ) => {

		let m = - Infinity;
		for ( const e of planes ) { const v = e.x * x + e.y * y + e.z * z - e.w; if ( v > m ) m = v; }
		return m;

	};

	return {

		toCut: ( x, y, z, out ) => {

			const dx = x - pos.x, dz = z - pos.z;
			return out.set( ( c * dx - s * dz ) / scale, ( y - pos.y ) / scale, ( s * dx + c * dz ) / scale );

		},

		toHolder: ( x, y, z, out ) => out.set( pos.x + scale * ( c * x + s * z ), pos.y + scale * y, pos.z + scale * ( - s * x + c * z ) ),

		// signed distance in cut units (plane maximum inside, true distance outside)
		sdCut,

		// nearest point on the surface (cut units), returns the distance
		nearCut: ( x, y, z, out ) => {

			p.set( x, y, z );
			let best = Infinity;

			for ( const e of tris ) {

				if ( Math.abs( e.nx * x + e.ny * y + e.nz * z - e.w ) >= best ) continue;
				e.t.closestPointToPoint( p, q );
				const d = q.distanceTo( p );
				if ( d < best ) { best = d; out.copy( q ); }

			}

			return best;

		},

		distCut: ( x, y, z ) => {

			const sd = sdCut( x, y, z );
			if ( sd <= 0 ) return sd;
			p.set( x, y, z );
			let best = Infinity;

			for ( const e of tris ) {

				if ( Math.abs( e.nx * x + e.ny * y + e.nz * z - e.w ) >= best ) continue;
				e.t.closestPointToPoint( p, q );
				const d = q.distanceTo( p );
				if ( d < best ) best = d;

			}

			return best;

		}

	};

}

// Heights of the galleries and of the prong path in cut units
function levels( cut, scale ) {

	// Rose: one gallery under the flat back (mountStone sets the height), tips on the dome at the edge
	if ( cut.kind === 'rose' ) return { flat: true, pav: [ { y: cut.minY, gal: true } ], girdle: true, hook: 0, tipRef: 0 };

	const T = scale < 0.22 ? [ { t: 0.65, gal: true } ]
		: [ { t: 0.2 }, { t: 0.45, gal: true }, { t: 0.65 }, { t: 0.82, gal: true } ];
	return { pav: T.map( o => ( { y: cut.minY * ( 1 - o.t ), gal: !! o.gal } ) ), girdle: true, hook: 0, tipRef: 0, flat: false };

}

// ---- Basket ----

export function mountStone( { parent, metal, cut, scale, surface, angle = 0, rotate = 0, profile = 1, kind = 'claw' } ) {

	const holder = new Group();
	holder.rotation.z = - angle;
	parent.add( holder );

	const petal = kind === 'petal';
	const big = scale >= 0.2, shadow = big && Math.abs( angle ) < 1e-6;
	const band = makeBand( surface, angle );
	const pos = new Vector3( 0, 0, band.zc );
	const stone = makeStone( cut, scale, rotate, pos );
	const { verts } = meshData( cut );
	const cr = Math.cos( rotate ), sr = Math.sin( rotate );

	// Seat height: pavilion tip at a distance above the band, each vertex above the top beneath it
	const lv = levels( cut, scale );
	const GAP = 0.005;
	const dirs = prongDirs( cut.kind ).length === 6 || ! petal ? prongDirs( cut.kind ) : [ 30, 90, 150, 210, 270, 330 ].map( a => a * RAD );

	// Root targets: one third of the way to the prong, the band offers no more room for prongs
	const targets = dirs.map( phiL => {

		const phiW = phiL - rotate, rs = supportRadius( cut.planes, phiL, lv.pav[ Math.min( 1, lv.pav.length - 1 ) ].y ) * scale;
		return { phiL, phiW, x: 0.35 * rs * Math.cos( phiW ), z: band.zc + 0.35 * rs * Math.sin( phiW ) };

	} );

	// Prong strength; on narrow or thin bands all prongs get slimmer until the root end fits
	const PR0 = Math.max( 0.012, 0.03 * Math.sqrt( scale / 0.33 ) * profile ), W0 = petal ? 0.78 : 1.12;
	let PR = PR0;

	for ( let i = 0; i < 10; i ++ ) {

		const want = PR * W0;
		let m = 1;
		for ( const t of targets ) m = Math.min( m, band.rootFor( t.x, t.z, want ).r / want );
		if ( m >= 0.999 ) break;
		PR *= m * 0.96;

	}

	const r0 = petal ? PR * 0.78 : PR * 1.12, r1 = petal ? PR * 0.58 : PR * 0.85;
	// Flat back (rose): the prongs run under the back, so the stone needs more clearance
	const gap = lv.flat ? 2 * r0 + 0.016 : 0.03 * Math.sqrt( scale / 0.33 ), margin = 0.007;
	if ( lv.flat ) lv.pav[ 0 ].y = cut.minY - ( r0 + 0.012 ) / scale;
	const low = verts.filter( v => v.y <= cut.minY + 0.5 * ( cut.maxY - cut.minY ) );
	let cy = band.R0 + - cut.minY * scale + gap;

	const lift = ( set, from ) => {

		let out = from;

		for ( const v of set ) {

			const x = ( cr * v.x + sr * v.z ) * scale, z = band.zc + ( - sr * v.x + cr * v.z ) * scale;
			const r = topRad( surface, angle + Math.atan2( x, from + v.y * scale ), z );
			if ( r === null ) continue;
			const need = Math.sqrt( Math.max( 0, ( r + ( v.y <= cut.minY + 0.01 ? gap : margin ) ) ** 2 - x * x ) ) - v.y * scale;
			if ( need > out ) out = need;

		}

		return out;

	};

	for ( let i = 0; i < 8; i ++ ) {

		const next = lift( low, cy );
		if ( next - cy < 1e-6 ) break;
		cy = next;

	}

	for ( let i = 0; i < 6; i ++ ) {

		const next = lift( verts, cy );
		if ( next - cy < 1e-6 ) break;
		cy = next + 0.001;

	}

	pos.y = cy;

	// Point at distance d (holder units) from the stone surface, at height yc (cut units)
	// in direction phiW in the holder
	const tmp = new Vector3();
	const radial = ( phiW, yc, d ) => {

		const phiL = phiW + rotate, ch = Math.cos( phiL ), sh = Math.sin( phiL ), dl = d / scale;
		let rs = supportRadius( cut.planes, phiL, yc );
		if ( ! ( rs > 0 ) ) rs = 0;
		let hi = Infinity;

		for ( const e of cut.planes ) {

			const h = e.x * ch + e.z * sh;
			if ( h > 1e-6 ) hi = Math.min( hi, ( e.w + dl - e.y * yc ) / h );

		}

		let lo = rs + dl;
		hi = Math.max( hi, lo + 1e-6 );

		for ( let i = 0; i < 16; i ++ ) {

			const m = ( lo + hi ) / 2;
			if ( stone.distCut( m * ch, yc, m * sh ) >= dl ) hi = m; else lo = m;

		}

		return stone.toHolder( hi * ch, yc, hi * sh, new Vector3() );

	};

	// Push point p away from the stone until it is at least need (holder units) away
	const near = new Vector3(), qq = new Vector3();

	const pushOut = ( p, need ) => {

		stone.toCut( p.x, p.y, p.z, qq );
		stone.nearCut( qq.x, qq.y, qq.z, near );
		const dir = qq.clone().sub( near );
		if ( stone.sdCut( qq.x, qq.y, qq.z ) < 0 ) dir.negate();
		if ( dir.lengthSq() < 1e-14 ) dir.set( qq.x, 0, qq.z );
		dir.normalize();
		qq.copy( near ).addScaledVector( dir, need / scale );
		return stone.toHolder( qq.x, qq.y, qq.z, new Vector3() );

	};

	// Check the wire between the support points: where the curve comes too close to the stone (corners, edges),
	// a support point is added. Support points stay unchanged, only the last section (tip) is skipped.
	const refine = ( pts, closed, radAt, tip ) => {

		for ( let pass = 0; pass < 4; pass ++ ) {

			const n = pts.length, segs = closed ? n : n - 1, per = 6;
			const curve = new CatmullRomCurve3( pts, closed, 'centripetal' );
			const worst = new Map(), p = new Vector3(), D = segs * per, lens = curve.getLengths( D );

			for ( let k = 0; k < segs * per; k ++ ) {

				const t = ( k + 0.5 ) / ( segs * per );
				curve.getPoint( t, p );
				if ( tip && p.distanceTo( tip ) < 0.03 ) continue;
				stone.toCut( p.x, p.y, p.z, qq );
				const rad = radAt( ( lens[ k ] + lens[ k + 1 ] ) / 2 / lens[ D ] ), room = stone.distCut( qq.x, qq.y, qq.z ) * scale - rad - 0.002;
				const seg = Math.floor( k / per );
				if ( room < 0 && ( ! worst.has( seg ) || room < worst.get( seg ).room ) ) worst.set( seg, { room, p: pushOut( p, rad + GAP ) } );

			}

			if ( ! worst.size ) break;
			const segsHit = [ ...worst.keys() ].sort( ( a, b ) => b - a );
			for ( const sg of segsHit ) pts.splice( sg + 1, 0, worst.get( sg ).p );

		}

		return pts;

	};

	// Prong tip: flattened dome, set so deep that it sinks at most 0.0015 into the crown
	const headR = PR * ( petal ? 1.1 : 0.95 ), HX = 1.15 * headR, HY = 0.85 * headR;
	const hv = HEAD_GEO.attributes.position.array;

	const sink = ( x, y, z ) => {

		let m = Infinity;

		for ( let i = 0; i < hv.length; i += 3 ) {

			stone.toCut( x + hv[ i ] * HX, y + hv[ i + 1 ] * HY, z + hv[ i + 2 ] * HX, tmp );
			const v = stone.sdCut( tmp.x, tmp.y, tmp.z ) * scale;
			if ( v < m ) m = v;

		}

		return m;

	};

	const tipAt = ( phiW, tipRef ) => {

		const phiL = phiW + rotate, rs = supportRadius( cut.planes, phiL, tipRef );
		const inset = Math.max( 0.036, 0.008 / scale );
		const r = Math.max( 0.05, rs - inset );
		const xz = stone.toHolder( r * Math.cos( phiL ), 0, r * Math.sin( phiL ), new Vector3() );
		// descend from above until the first contact: under the pavilion the tip does not sink in either,
		// a bisection over the whole stone height lands there on steep pavilions (princess, hexagon)
		const floor = pos.y + ( cut.minY - 0.1 ) * scale;
		let hi = pos.y + cut.maxY * scale + HY + 0.002, lo = null;

		for ( let y = hi; y > floor; y -= 0.006 ) {

			if ( sink( xz.x, y, xz.z ) < - 0.0015 ) { lo = y; break; }
			hi = y;

		}

		if ( lo === null ) return new Vector3( xz.x, pos.y + tipRef * scale, xz.z );

		for ( let i = 0; i < 12; i ++ ) {

			const m = ( lo + hi ) / 2;
			if ( sink( xz.x, m, xz.z ) >= - 0.0015 ) hi = m; else lo = m;

		}

		return new Vector3( xz.x, hi, xz.z );

	};

	// Prong path
	const rootDepth = r0;

	// Half width of a petal (angle) along the path, s from 0 (root) to 1 (tip)
	const leaf = ( s ) => 0.4 * Math.pow( Math.sin( Math.PI * clamp( s, 0, 1 ) ), 0.75 );

	// Points of a wire: phiW is the direction, side shifts it to the petal edge
	const makePath = ( phiW, side, root, tip, fr ) => {

		// Heights: pavilion, then around the girdle edge (distances in holder units above the girdle)
		const ys = lv.pav.map( o => ( { y: o.y, gal: o.gal, gap: 0.03 } ) );

		if ( lv.girdle ) for ( const k of [ - 0.8, 0, 0.5, 1 ] ) ys.push( { y: k * PR / scale, gap: k < 0 ? 0.5 * PR : 0 } );
		else ys.push( { y: lv.hook, gap: 0 } );

		const y0 = ys[ 0 ].y, y1 = ys[ ys.length - 1 ].y + 0.05;
		const prog = ( yc ) => clamp( ( yc - y0 ) / ( y1 - y0 ), 0, 1 );
		const out = [], galPts = [];
		let prevY = - Infinity;

		ys.forEach( ( e, j ) => {

			const yc = e.y, isGal = !! e.gal;
			const h = stone.toHolder( 0, yc, 0, tmp ).y;
			if ( ! isGal && h - prevY < e.gap ) return;
			prevY = h;
			const frac = fr ? fr[ out.length + 2 ] : 0.5;
			const ph = phiW + ( petal ? side * leaf( prog( yc ) ) : 0 );
			const pt = radial( ph, yc, r0 + ( r1 - r0 ) * frac + GAP );
			out.push( pt );
			if ( isGal ) galPts.push( pt );

		} );

		const first = out[ 0 ];
		const x1 = root.x + ( first.x - root.x ) * 0.3, z1 = root.z + ( first.z - root.z ) * 0.3;
		const top = band.topY( x1, z1 );
		const rise = new Vector3( x1, ( top === null ? root.y + rootDepth : top ) + PR, z1 );
		return { pts: [ root, rise, ...out, tip ], galPts };

	};

	const lengths = ( pts ) => {

		const c = [ 0 ];
		for ( let i = 1; i < pts.length; i ++ ) c.push( c[ i - 1 ] + pts[ i ].distanceTo( pts[ i - 1 ] ) );
		return c.map( v => v / c[ c.length - 1 ] );

	};

	const add = ( geo, shadow ) => {

		const m = new Mesh( geo, metal );
		m.castShadow = shadow; m.receiveShadow = true;
		holder.add( m );
		return m;

	};

	// Galleries just below the girdle protrude past the outline on narrow and pointed stones
	// and are visible from above. Then set lower until the wire protrudes at most 0.005.
	if ( ! lv.flat ) {

		const d = GAP + ( r0 + r1 ) / 2, floor = cut.minY * 0.4, M = 180, ring = [];
		const girdle = ( phiW ) => supportRadius( cut.planes, phiW + rotate, 0 ) * scale;

		for ( let i = 0; i < M; i ++ ) {

			const phi = i / M * TAU, r = girdle( phi );
			ring.push( [ r * Math.cos( phi ), r * Math.sin( phi ) ] );

		}

		// Distance outside the outline in top view, 0 inside
		const outside = ( x, z ) => {

			if ( Math.hypot( x, z ) <= girdle( Math.atan2( z, x ) ) ) return 0;
			let m = Infinity;

			for ( let i = 0; i < M; i ++ ) {

				const [ ax, az ] = ring[ i ], [ bx, bz ] = ring[ ( i + 1 ) % M ];
				const ex = bx - ax, ez = bz - az, t = clamp( ( ( x - ax ) * ex + ( z - az ) * ez ) / ( ex * ex + ez * ez ), 0, 1 );
				m = Math.min( m, Math.hypot( x - ax - t * ex, z - az - t * ez ) );

			}

			return m;

		};

		const over = ( y ) => {

			let m = 0;

			for ( let i = 0; i < 36; i ++ ) {

				const p = radial( ( i + 0.5 ) / 36 * TAU, y, d );
				m = Math.max( m, outside( p.x - pos.x, p.z - pos.z ) );

			}

			return m;

		};

		for ( const o of lv.pav ) while ( o.gal && o.y > floor && over( o.y ) > 0.005 ) o.y = Math.max( floor, o.y + 0.04 * cut.minY );
		lv.pav.sort( ( a, b ) => a.y - b.y );

	}

	const claws = [], tips = [], allPts = [];
	const galSamples = lv.pav.map( () => [] ); // per gallery: { phi, pt }
	const galIdx = lv.pav.map( ( o, j ) => o.gal ? j : - 1 ).filter( j => j >= 0 );
	const wseg = big ? 96 : 64, wrad = big ? 14 : 12;

	for ( const { phiW, x, z } of targets ) {

		const root = band.rootPoint( band.rootFor( x, z, r0 ), rootDepth );
		const tip = tipAt( phiW, lv.tipRef );
		const sides = petal ? [ - 1, 1 ] : [ 0 ];
		const meshes = [], paths = [];

		for ( const side of sides ) {

			let r = makePath( phiW, side, root, tip, null );
			r = makePath( phiW, side, root, tip, lengths( r.pts ) );
			r.pts = refine( r.pts, false, t => r0 + ( r1 - r0 ) * t, tip );
			meshes.push( add( wire( r.pts, r0, r1, { seg: wseg, rad: wrad } ), shadow ) );
			allPts.push( ...r.pts );
			paths.push( r.pts );

			galIdx.forEach( ( j, g ) => {

				const pt = r.galPts[ g ];
				const w = ( Math.atan2( pt.z - pos.z, pt.x - pos.x ) + TAU ) % TAU;
				galSamples[ j ].push( { phi: w, pt } );

			} );

		}

		const head = add( HEAD_GEO, shadow );
		head.position.copy( tip );
		head.scale.set( HX, HY, HX );
		meshes.push( head );
		tips.push( tip );
		claws.push( { meshes, root, tip, paths } );

	}

	// Galleries: closed wires around the stone at the height of the gallery points, through all prongs
	const gal = [];
	const gR = PR * 0.57 * ( petal ? 0.8 : 1 );
	const N = big ? 56 : 40;

	lv.pav.forEach( ( o, j ) => {

		if ( ! o.gal ) return;
		const fixed = galSamples[ j ].slice().sort( ( a, b ) => a.phi - b.phi );
		const d = GAP + ( r0 + r1 ) / 2;
		const list = fixed.map( e => ( { phi: e.phi, pt: e.pt } ) );

		for ( let i = 0; i < N; i ++ ) {

			const phi = ( i + 0.5 ) / N * TAU;
			const tooClose = fixed.some( e => Math.abs( ( ( e.phi - phi + Math.PI * 3 ) % TAU ) - Math.PI ) < 0.45 * TAU / N );
			if ( tooClose ) continue;
			list.push( { phi, pt: radial( phi, o.y, d ) } );

		}

		list.sort( ( a, b ) => a.phi - b.phi );
		const pts = refine( list.map( e => e.pt ), true, () => gR );
		const m = add( wire( pts, gR, gR, { seg: big ? 112 : 80, rad: 12, closed: true } ), shadow );
		m.userData.gallery = true;
		gal.push( { y: o.y, pts } );
		allPts.push( ...pts );

	} );

	// Width of the basket around the ring
	let xmax = 0;
	for ( const v of verts ) xmax = Math.max( xmax, Math.abs( ( cr * v.x + sr * v.z ) * scale ) );
	for ( const q of allPts ) xmax = Math.max( xmax, Math.abs( q.x ) + PR );

	return {
		holder,
		gemPosition: pos.clone(),
		gemRotationY: rotate,
		halfAngle: Math.asin( Math.min( 0.95, xmax / band.R0 ) ),
		prongTips: tips,
		claws,
		gallery: gal,
		PR
	};

}

// Cathedral arches: two wires per side rise from the shoulders (a = ±0.55) to the lower gallery.
export function cathedralArches( { parent, metal, surface, head, profile = 1 } ) {

	const angle = - head.holder.rotation.z;
	head.holder.updateMatrix();
	const lowest = head.gallery[ 0 ].pts, zc = head.gemPosition.z;
	const rad = 0.022 * profile;
	const meshes = [], feet = [], ends = [];

	for ( const sgn of [ - 1, 1 ] ) for ( const zs of [ - 1, 1 ] ) {

		// Foot: in the metal, near the band edge
		const af = angle + sgn * 0.55, spans = spansAt( surface, af );
		const lo = Math.min( ...spans.map( s => s[ 0 ] ) ), hi = Math.max( ...spans.map( s => s[ 1 ] ) );
		let zf = ( lo + hi ) / 2 + zs * 0.55 * ( hi - lo ) / 2, rf = topRad( surface, af, zf );

		if ( rf === null ) {

			const s = spans.reduce( ( b, q ) => Math.abs( ( q[ 0 ] + q[ 1 ] ) / 2 - zf ) < Math.abs( ( b[ 0 ] + b[ 1 ] ) / 2 - zf ) ? q : b );
			zf = clamp( zf, s[ 0 ] + 0.2 * ( s[ 1 ] - s[ 0 ] ), s[ 1 ] - 0.2 * ( s[ 1 ] - s[ 0 ] ) );
			rf = topRad( surface, af, zf );

		}

		const F = new Vector3( ( rf - 0.03 ) * Math.sin( af ), ( rf - 0.03 ) * Math.cos( af ), zf );

		// End: gallery point between side and corner prong
		const want = Math.atan2( zs * 0.5, sgn );
		let E = null, bd = Infinity;

		for ( const p of lowest ) {

			const d = Math.abs( ( ( Math.atan2( p.z - zc, p.x ) - want + Math.PI * 3 ) % TAU ) - Math.PI );
			if ( d < bd ) { bd = d; E = p; }

		}

		E = E.clone().applyMatrix4( head.holder.matrix );

		// Middle: just above the band, then on to the gallery
		const a1 = angle + sgn * 0.36, z1 = ( zf + E.z ) / 2, r1 = topRad( surface, a1, z1 );
		const rr = ( r1 === null ? rf : r1 ) + 0.035;
		const P1 = new Vector3( rr * Math.sin( a1 ), rr * Math.cos( a1 ), z1 );
		const Pm = P1.clone().lerp( E, 0.5 );
		const m = new Mesh( wire( [ F, P1, Pm, E ], rad * 1.1, rad * 0.9, { seg: 64, rad: 14 } ), metal );
		m.castShadow = true; m.receiveShadow = true;
		parent.add( m );
		meshes.push( m ); feet.push( F ); ends.push( E );

	}

	return { meshes, feet, ends };

}
