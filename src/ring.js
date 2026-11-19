// SPDX-License-Identifier: AGPL-3.0-or-later
// Example ring, built entirely from code: band, settings, center stone, side stones, pavé.
// Built upright (head at +Y, ring axis Z); layDown() places it as on the photo table.
import {
	Group, Mesh, TorusGeometry, SphereGeometry, CatmullRomCurve3,
	Vector3, MeshPhysicalNodeMaterial, Color, BufferGeometry, Float32BufferAttribute
} from 'three';

// Wire along a curve that tapers from r0 to r1 (prongs are thicker at the bottom).
// closed: closed ring without a seam (gallery).
function wire( pts, r0, r1 = r0, { seg = 72, rad = 18, closed = false } = {} ) {

	const curve = new CatmullRomCurve3( pts, closed, 'centripetal' );
	const fr = curve.computeFrenetFrames( seg, closed );
	const pos = [], nor = [], idx = [];
	const p = new Vector3(), n = new Vector3();

	for ( let i = 0; i <= seg; i ++ ) {

		const u = i / seg;
		curve.getPointAt( u, p );
		const r = r0 + ( r1 - r0 ) * u;
		const N = fr.normals[ i ], B = fr.binormals[ i ];

		for ( let j = 0; j <= rad; j ++ ) {

			const v = j / rad * Math.PI * 2, s = Math.sin( v ), c = - Math.cos( v );
			n.set( c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z ).normalize();
			pos.push( p.x + r * n.x, p.y + r * n.y, p.z + r * n.z );
			nor.push( n.x, n.y, n.z );

		}

	}

	for ( let i = 0; i < seg; i ++ ) for ( let j = 0; j < rad; j ++ ) {

		const a = i * ( rad + 1 ) + j, b = a + rad + 1;
		idx.push( a, b, a + 1, b, b + 1, a + 1 );

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nor, 3 ) );
	g.setIndex( idx );
	return g;

}
import { makeCut } from './gemcut.js';
import { GemMaterial, STONES } from './gem.js';

// High-gloss polished: Three clamps the roughness at 0.045 anyway.
// warm: strength of the gold curve in main.js (dark tones brown-orange, light ones paler), 0 for white metals
export const METALS = {
	platinum: { name: 'Platinum', color: '#e4e3e0', roughness: 0.05, warm: 0 },
	whitegold: { name: 'White gold', color: '#e9e8e6', roughness: 0.05, warm: 0 },
	palladium: { name: 'Palladium', color: '#e3e1dc', roughness: 0.05, warm: 0 },
	silver: { name: 'Silver', color: '#f2f0ec', roughness: 0.05, warm: 0 },
	yellowgold: { name: 'Yellow gold 18k', color: '#f4d9a2', roughness: 0.05, warm: 1 },
	yellowgold14: { name: 'Yellow gold 14k', color: '#f2e0b8', roughness: 0.05, warm: 0.75 },
	rosegold: { name: 'Rose gold', color: '#efc1ad', roughness: 0.05, warm: 0.5 }
};

// Ring band as a profile revolved about the Z axis, head at +Y.
// Cross-section: superellipse with flat flanks and rounded edges, domed outside,
// slightly crowned inside (comfort fit). Wider and heavier at the top than at the bottom.
// The normals come from the profile itself so the light edges run through cleanly.
function bandGeometry( { top, width, thick, taper = 0.82, nOut = 3.4, nIn = 2.4, seg = 384, prof = 112 } ) {

	const pos = [], nor = [], idx = [];
	const p2 = ( t, a, b ) => {

		// Point on the profile (z, r relative to the center) for parameter t
		const c = Math.cos( t ), s = Math.sin( t ), n = s >= 0 ? nOut : nIn;
		return [ a * Math.sign( c ) * Math.pow( Math.abs( c ), 2 / n ), b * Math.sign( s ) * Math.pow( Math.abs( s ), 2 / n ) ];

	};

	for ( let i = 0; i <= seg; i ++ ) {

		const th = i / seg * Math.PI * 2;
		const ct = Math.cos( th ), st = Math.sin( th );
		// 1 at the top (head), 0 at the bottom
		const k = ( st + 1 ) / 2, f = taper + ( 1 - taper ) * k * k;
		const a = width / 2 * f, b = thick / 2 * f;
		const rc = top - b;

		for ( let j = 0; j <= prof; j ++ ) {

			const t = j / prof * Math.PI * 2;
			const [ z, dr ] = p2( t, a, b );
			// Tangent numerically, normal perpendicular to it, pointing outward
			const e = 1e-4;
			const [ z1, r1 ] = p2( t - e, a, b ), [ z2, r2 ] = p2( t + e, a, b );
			let nz = r2 - r1, nr = - ( z2 - z1 );
			const l = Math.hypot( nz, nr ) || 1;
			nz /= l; nr /= l;
			const r = rc + dr;
			pos.push( r * ct, r * st, z );
			nor.push( nr * ct, nr * st, nz );

		}

	}

	for ( let i = 0; i < seg; i ++ ) for ( let j = 0; j < prof; j ++ ) {

		const a = i * ( prof + 1 ) + j, b = a + prof + 1;
		idx.push( a, a + 1, b, b, a + 1, b + 1 );

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new Float32BufferAttribute( nor, 3 ) );
	g.setIndex( idx );
	return g;

}

// Stone material per position; the viewer passes its stock in here so a rebuild needs no
// new shaders. key: center, side0, side1, pave
const ownMaterial = ( key, cut ) => new GemMaterial( cut, STONES.diamond );

export function buildRing( { material = ownMaterial, metal = new MeshPhysicalNodeMaterial( { metalness: 1, roughness: METALS.platinum.roughness, color: new Color( METALS.platinum.color ) } ) } = {} ) {

	const ring = new Group();
	const gems = []; // { mesh, group }

	const addMetal = ( geo, parent = ring ) => {

		const m = new Mesh( geo, metal );
		m.castShadow = true; m.receiveShadow = true;
		parent.add( m );
		return m;

	};

	const TOP = 1.04;

	// Band: 0.17 wide at the top (carries pavé and side stones), 0.115 thick
	addMetal( bandGeometry( { top: TOP, width: 0.17, thick: 0.115 } ) );

	const round = makeCut( 'brilliant' );
	const small = makeCut( 'brilliant' );
	const step = makeCut( 'emerald' );

	const mats = {
		center: material( 'center', round ),
		side: [ material( 'side0', step ), material( 'side1', step ) ],
		pave: material( 'pave', small )
	};

	const addGem = ( cut, mat, group, scale, parent ) => {

		const m = new Mesh( cut.geometry, mat );
		m.scale.setScalar( scale );
		// no shadow casting: the light behind the stone supplies the caustics
		m.castShadow = false;
		parent.add( m );
		gems.push( { mesh: m, group, cut, scale } );
		return m;

	};

	// Center stone in a basket of four prongs. Each prong grows out of the band, rises steeply
	// at first and then follows the pavilion at a fixed distance up to the girdle, at the top it
	// reaches over the crown. Two gallery rings run exactly through the prongs, so the basket
	// supports itself.
	const cs = 0.33;
	const cy = TOP + cs * 0.9 + 0.03;
	addGem( round, mats.center, 'center', cs, ring ).position.set( 0, cy, 0 );

	const RG = 1.02 * cs, CUL = cy - 0.901 * cs; // girdle radius, tip of the pavilion
	const PR = 0.03, OFF = PR + 0.004; // prong thickness, distance of the prong center from the pavilion
	const cone = ( t ) => [ RG * t + OFF, CUL + t * ( cy - CUL ) ]; // at height t of the pavilion
	const G1 = 0.45, G2 = 0.82; // heights of the gallery rings

	for ( const t of [ G1, G2 ] ) {

		const [ r, y ] = cone( t );
		const g = addMetal( new TorusGeometry( r, 0.017, 16, 128 ) );
		g.rotation.x = Math.PI / 2; g.position.y = y;

	}

	for ( let k = 0; k < 4; k ++ ) {

		const a = ( 45 + k * 90 ) * Math.PI / 180, c = Math.cos( a ), s = Math.sin( a );
		const path = [ [ 0.065, TOP - 0.035 ], [ 0.085, TOP + 0.03 ], cone( G1 ), cone( 0.65 ), cone( G2 ), [ RG + OFF, cy ],
			[ RG + OFF * 0.7, cy + 0.03 ], [ RG - 0.006, cy + 0.042 ] ];
		const pts = path.map( ( [ r, y ] ) => new Vector3( c * r, y, s * r ) );
		addMetal( wire( pts, PR * 1.12, PR * 0.85, { seg: 96 } ) );
		// Prong tip: flattened dome on the crown
		const tip = addMetal( new SphereGeometry( PR * 0.95, 32, 20 ) );
		tip.position.set( c * ( RG - 0.012 ), cy + 0.043, s * ( RG - 0.012 ) );
		tip.scale.set( 1.15, 0.72, 1.15 );

	}

	// Side stones in step cut, each in a basket: four corner prongs grow out of the band, run
	// outward to the beveled corners of the girdle and are connected below the stone by a
	// gallery. The stones are wider than the band, the basket bridges the difference.
	const ss = 0.125, gy = TOP + ss * 1.05;
	// Middle of the corner bevel (cut: corner from (1, 0.82) to (0.44, 1.38)) and its outward direction
	const CX = 0.72 * ss, CZ = 1.1 * ss, ON = Math.SQRT1_2;
	const SR = 0.02, SO = SR + 0.003;

	for ( const sgn of [ - 1, 1 ] ) {

		const holder = new Group();
		holder.rotation.z = - sgn * 24 * Math.PI / 180;
		ring.add( holder );
		addGem( step, mats.side[ ( sgn + 1 ) / 2 ], 'side', ss, holder ).position.set( 0, gy, 0 );

		const railY = gy - 0.045, rail = [];

		for ( const [ px, pz ] of [ [ 1, 1 ], [ - 1, 1 ], [ - 1, - 1 ], [ 1, - 1 ] ] ) {

			const at = ( x, y, z ) => new Vector3( px * x, y, pz * z );
			const g = at( CX + ON * SO, gy, CZ + ON * SO ); // at the girdle
			const r = at( CX + ON * SO - 0.008, railY, CZ + ON * SO - 0.01 ); // at gallery height
			rail.push( r );
			const pts = [ at( 0.05, TOP - 0.03, 0.045 ), at( 0.06, TOP + 0.03, 0.07 ), r, g,
				at( CX + ON * SO * 0.6, gy + 0.018, CZ + ON * SO * 0.6 ), at( CX - 0.004, gy + 0.025, CZ - 0.004 ) ];
			const p = addMetal( wire( pts, SR * 1.1, SR * 0.85, { seg: 64, rad: 14 } ), holder );
			// Small parts cast no shadow: under a large softbox it almost vanishes,
			// a shadow map draws hard strokes from it
			p.castShadow = false;
			const tip = addMetal( new SphereGeometry( SR * 0.95, 20, 12 ), holder );
			tip.castShadow = false;
			tip.position.set( px * ( CX - 0.006 ), gy + 0.025, pz * ( CZ - 0.006 ) );
			tip.scale.set( 1.1, 0.7, 1.1 );

		}

		// Gallery: straight between the prongs, rounded at the corners
		const loop = [];
		for ( let i = 0; i < 4; i ++ ) {

			const a = rail[ i ], b = rail[ ( i + 1 ) % 4 ];
			loop.push( a, a.clone().lerp( b, 0.5 ) );

		}
		const gal = addMetal( wire( loop, 0.012, 0.012, { seg: 96, rad: 12, closed: true } ), holder );
		gal.castShadow = false;

	}

	// Pavé on the shoulders: stones as wide as the band, set close together and so deep
	// that the girdle lies in the band. Each pair of neighbours shares a bead prong at
	// every edge.
	const PAVE = 7, ps = 0.074;
	const pitch = 2 * ps * 1.05 / TOP, start = 36 * Math.PI / 180;

	for ( const sgn of [ - 1, 1 ] ) {

		for ( let i = 0; i < PAVE; i ++ ) {

			const holder = new Group();
			holder.rotation.z = - sgn * ( start + i * pitch );
			ring.add( holder );
			addGem( small, mats.pave, 'pave', ps, holder ).position.set( 0, TOP - 0.002, 0 );

		}

		// Prongs in the gaps between the stones and at both ends of the row
		for ( let i = 0; i <= PAVE; i ++ ) {

			const th = sgn * ( start + ( i - 0.5 ) * pitch ), r = TOP + 0.012;

			for ( const pz of [ - 1, 1 ] ) {

				const b = addMetal( new SphereGeometry( 0.024, 18, 12 ) );
				b.castShadow = false;
				b.position.set( Math.sin( th ) * r, Math.cos( th ) * r, pz * 0.056 );

			}

		}

		// Rail under the girdle: the band is rounded at the edges, without a rail the girdle at the
		// stone center would stand up to 0.024 above the metal. The rail fills the rounding under
		// the row and ends in the outer bead prongs.
		const f0 = start - 0.5 * pitch, f1 = start + ( PAVE - 0.5 ) * pitch, RR = TOP - 0.014, RT = 0.012;

		for ( const pz of [ - 1, 1 ] ) {

			// Bake the rotation into the geometry: as a mesh rotation the fast bounding box of the
			// arc inflates, framing and GLB alignment then measure the ring too wide
			const rg = new TorusGeometry( RR, RT, 12, 96, f1 - f0 );
			rg.rotateZ( sgn > 0 ? Math.PI / 2 - f1 : Math.PI / 2 + f0 );
			rg.translate( 0, 0, pz * 0.063 );
			const rail = addMetal( rg );
			rail.castShadow = false;

			for ( const f of [ f0, f1 ] ) {

				const c = addMetal( new SphereGeometry( RT, 12, 8 ) );
				c.castShadow = false;
				c.position.set( sgn * Math.sin( f ) * RR, Math.cos( f ) * RR, pz * 0.063 );

			}

		}

	}

	return { ring, metal, mats, gems };

}

// Lays the ring down: band flat, head forward, tilted so that band and head rest on the surface.
export function layDown( ring ) {

	ring.rotation.set( 0, 0, 0 ); ring.position.set( 0, 0, 0 ); ring.updateMatrixWorld( true );

	const head = [], back = [];
	const v = new Vector3();

	ring.traverse( o => {

		if ( ! o.isMesh ) return;
		const p = o.geometry.attributes.position;
		const stride = Math.max( 1, Math.floor( p.count / 400 ) );

		for ( let i = 0; i < p.count; i += stride ) {

			v.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld );
			if ( v.y > 0.6 ) head.push( v.clone() ); else if ( v.y < - 0.3 ) back.push( v.clone() );

		}

	} );

	// Rotation about X: angle a takes +Y to +Z (front) and tips the head downward
	const low = ( pts, a ) => {

		let m = Infinity;
		const s = Math.sin( a ), c = Math.cos( a );
		for ( const p of pts ) m = Math.min( m, p.y * c - p.z * s );
		return m;

	};

	let lo = 0.9, hi = 2.2;

	for ( let i = 0; i < 40; i ++ ) {

		const mid = ( lo + hi ) / 2;
		if ( low( head, mid ) > low( back, mid ) ) lo = mid; else hi = mid;

	}

	const a = ( lo + hi ) / 2;
	ring.rotation.x = a;
	ring.position.y = - Math.min( low( head, a ), low( back, a ) );
	ring.updateMatrixWorld( true );

}
