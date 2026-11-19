// SPDX-License-Identifier: AGPL-3.0-or-later
// Band finishes without textures: brushed (fine grinding marks along the band) and
// hammered (shallow dimples). The height comes from noise in the shader, the normal follows from it
// via screen-space derivatives (bump mapping after Mikkelsen).
import { MeshPhysicalNodeMaterial } from 'three';
import { Fn, vec2, uv, positionLocal, positionView, normalView, cross, dot, normalize, abs, sign, faceDirection, mx_noise_float, mx_worley_noise_float } from 'three/tsl';

const bump = ( height ) => Fn( () => {

	const dHdxy = vec2( height.dFdx(), height.dFdy() );
	const sx = positionView.dFdx(), sy = positionView.dFdy(), n = normalView;
	const r1 = cross( sy, n ), r2 = cross( n, sx );
	const det = dot( sx, r1 ).mul( faceDirection );
	const grad = sign( det ).mul( r1.mul( dHdxy.x ).add( r2.mul( dHdxy.y ) ) );
	return normalize( abs( det ).mul( n ).sub( grad ) );

} )();

// The band carries uv: x runs once around from 0 to 12, y across from -1 to 1
const HEIGHT = {
	// marks about 0.06 mm wide and a few millimeters long
	brushed: () => mx_noise_float( vec2( uv().x.mul( 1.5 ), uv().y.mul( 14 ) ) ).mul( 0.0009 ),
	// dimples about 0.9 mm across, measured on the ring (one unit is 8.92 mm)
	hammered: () => mx_worley_noise_float( positionLocal.mul( 10 ) ).pow( 2 ).mul( 0.006 )
};

const ROUGH = { brushed: 0.3, hammered: 0.12 };

export function finishMaterial( kind ) {

	const m = new MeshPhysicalNodeMaterial( { metalness: 1, roughness: ROUGH[ kind ] } );
	m.normalNode = bump( HEIGHT[ kind ]() );
	m.finish = kind;
	return m;

}
