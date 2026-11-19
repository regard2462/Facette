// SPDX-License-Identifier: AGPL-3.0-or-later
// Wire along a curve (prongs, galleries, arches); copy from ring.js.
import { CatmullRomCurve3, Vector3, BufferGeometry, Float32BufferAttribute } from 'three';

// Wire along a curve, tapering from r0 to r1 (prongs are thicker at the bottom).
// closed: closed ring without a seam (gallery).
export function wire( pts, r0, r1 = r0, { seg = 72, rad = 18, closed = false } = {} ) {

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
