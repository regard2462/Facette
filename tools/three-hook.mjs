// SPDX-License-Identifier: AGPL-3.0-or-later
// Resolve hook for Node: 'three' points to the WebGPU build with the NodeMaterials, as in the
// browser (import map). Start: node --import ./tools/three-hook.mjs script.mjs
import { register } from 'node:module';

const source = `
export async function resolve( specifier, context, nextResolve ) {

	if ( specifier === 'three' ) return nextResolve( 'three/webgpu', context );
	return nextResolve( specifier, context );

}
`;

register( 'data:text/javascript,' + encodeURIComponent( source ), import.meta.url );
