// SPDX-License-Identifier: AGPL-3.0-or-later
// Ring editor: builds a ring from a design. Style, profile, cut and weight of the
// center stone, band and pavé. Stone type and metal are material only and need no rebuild.
// The default design builds the hand-set ring from ring.js unchanged.
import { Group, Mesh, MeshPhysicalNodeMaterial, Color } from 'three';
import { bandSurface, sweepBand, BAND_DEFAULT, MM } from './band.js';
import { mountStone, cathedralArches } from './head.js';
import { paveLayout, grainGeometry, beadGeometry, scaleForCarat, PAVE_DEFAULT } from './pave.js';
import { makeCut, cutVolume, supportRadius } from './gemcut.js';
import { STONE_BY_ID } from './gem.js';
import { buildRing, METALS } from './ring.js';

export const STYLES = [
	{ id: 'cluster', name: 'Pavé trilogy' },
	{ id: 'solitaire', name: 'Solitaire' },
	{ id: 'pave', name: 'Pavé' },
	{ id: 'trilogy', name: 'Trilogy' },
	{ id: 'cathedral', name: 'Cathedral' },
	{ id: 'split', name: 'Split shank' },
	{ id: 'eastwest', name: 'East-west' },
	{ id: 'knife', name: 'Knife edge' },
	{ id: 'dome', name: 'Dome' },
	{ id: 'petal', name: 'Petal' },
	{ id: 'cable', name: 'Cable' },
	{ id: 'ribbon', name: 'Wave' },
	{ id: 'wishbone', name: 'Wishbone' },
	{ id: 'bypass', name: 'Bypass' },
	{ id: 'interlace', name: 'Interlaced' },
	{ id: 'double', name: 'Double band' },
	{ id: 'marquise', name: 'Vines' },
	{ id: 'fluted', name: 'Fluted' }
];

export const PROFILES = {
	fine: { name: 'Fine', k: 0.85 },
	classic: { name: 'Classic', k: 1 },
	bold: { name: 'Bold', k: 1.25 }
};

export const CARAT_RANGE = [ 0.5, 3 ];

// Carat from cut, scale (girdle radius in units) and density, and the inverse
export const caratFor = ( cut, scale, rho ) => rho * cutVolume( cut ) * ( scale / MM ) ** 3 / 200;
export const scaleFor = ( cut, carat, rho ) => Math.cbrt( carat * 200 / ( rho * cutVolume( cut ) ) ) * MM;

// Center stone of the default ring: brilliant with scale 0.33
const BRILLIANT = makeCut( 'brilliant' );
const START_CARAT = caratFor( BRILLIANT, 0.33, 3.52 );

export const DEFAULT_DESIGN = {
	style: 'cluster',
	profile: 'classic',
	cut: 'brilliant',
	carat: START_CARAT,
	band: { ...BAND_DEFAULT },
	pave: { ...PAVE_DEFAULT }
};

// Defaults per style: band shape and pavé
export function styleDefaults( style ) {

	const band = { ...BAND_DEFAULT };
	if ( style === 'knife' ) Object.assign( band, { shape: 'knife', front: 2.4, width: 1.6, thickness: 1.5 } );
	if ( style === 'eastwest' ) Object.assign( band, { shape: 'flat', front: 2, width: 1.8, thickness: 1.4 } );
	if ( style === 'dome' ) Object.assign( band, { shape: 'domed', front: 5.6, width: 4.5, thickness: 1.8 } );
	if ( style === 'split' ) Object.assign( band, { shoulders: 'split', front: 3.4 } );
	if ( [ 'cable', 'interlace', 'double', 'marquise', 'fluted', 'ribbon', 'bypass', 'wishbone' ].includes( style ) ) Object.assign( band, { front: 2.2, width: 2, thickness: 1.3 } );
	const pave = { ...PAVE_DEFAULT, count: style === 'pave' || style === 'cluster' ? PAVE_DEFAULT.count : 0 };
	return { band, pave };

}

// Compare designs (numbers equal up to rounding noise)
const same = ( a, b ) => {

	if ( typeof a === 'number' && typeof b === 'number' ) return Math.abs( a - b ) < 1e-9;
	if ( a && b && typeof a === 'object' ) return Object.keys( { ...a, ...b } ).every( k => same( a[ k ], b[ k ] ) );
	return a === b;

};

// The default design (finish and edge are not part of the band shape)
export const isStartDesign = ( d ) => same( { ...d, band: { ...d.band, finish: 'polished' } }, DEFAULT_DESIGN ) && d.band.edge === 'plain';

// Angle that a length spans along the top of the band
const arc = ( surface, len ) => len / surface.section( 0, 0, 1, 0 )[ 1 ];

/**
 * Builds the ring of a design.
 * material( key, cut ): stone material per position (center, side0, side1, pave)
 * metal: material for setting and band, bandMetal: material of the band (finish)
 * stone: id of the center stone (density for the weight)
 * Returns { ring, gems } like buildRing.
 */
export function buildDesign( d, { material, metal, bandMetal = metal, stone = 'lab-diamond' } ) {

	// The weight applies to the chosen stone type: a ruby of equal weight is smaller
	const rho = STONE_BY_ID[ stone ]?.rho ?? 3.52;
	if ( isStartDesign( d ) && bandMetal === metal && rho === 3.52 ) return buildRing( { material, metal } );

	const ring = new Group();
	const gems = [];
	const k = PROFILES[ d.profile ]?.k ?? 1;
	const band = { ...d.band, thickness: d.band.thickness * k };
	const surface = bandSurface( d.style, band );

	const addMetal = ( geo, parent = ring, mat = metal, shadow = true ) => {

		const m = new Mesh( geo, mat );
		m.castShadow = shadow; m.receiveShadow = true;
		parent.add( m );
		return m;

	};

	const addGem = ( cut, mat, group, scale, parent, pos, rotY = 0 ) => {

		const m = new Mesh( cut.geometry, mat );
		m.scale.setScalar( scale );
		m.position.copy( pos );
		m.rotation.y = rotY;
		m.castShadow = false;
		parent.add( m );
		gems.push( { mesh: m, group, cut, scale } );
		return m;

	};

	addMetal( sweepBand( surface ), ring, bandMetal );

	// Center stone
	const cut = makeCut( d.cut );
	const scale = scaleFor( cut, d.carat, rho );
	const rotate = d.style === 'eastwest' ? Math.PI / 2 : 0;
	const head = mountStone( { parent: ring, metal, cut, scale, surface, angle: 0, rotate, profile: k, kind: d.style === 'petal' ? 'petal' : 'claw' } );
	addGem( cut, material( 'center', cut ), 'center', scale, head.holder, head.gemPosition, head.gemRotationY );
	let reach = head.halfAngle;

	// Side stones: trilogy in the cut of the center stone, pavé trilogy in step cut
	if ( d.style === 'trilogy' || d.style === 'cluster' ) {

		const sideCut = d.style === 'trilogy' ? makeCut( d.cut ) : makeCut( 'emerald' );
		const sideScale = d.style === 'trilogy' ? scale * Math.cbrt( 0.3 * cutVolume( cut ) / cutVolume( sideCut ) ) : scale * 0.125 / 0.33;
		// half length of the side stone along the band (holder X direction)
		const half = Math.max( supportRadius( sideCut.planes, 0, 0 ), supportRadius( sideCut.planes, Math.PI, 0 ) ) * sideScale;
		const angle = head.halfAngle + arc( surface, half + 0.02 );

		[ - 1, 1 ].forEach( ( sgn, i ) => {

			const side = mountStone( { parent: ring, metal, cut: sideCut, scale: sideScale, surface, angle: sgn * angle, profile: k } );
			addGem( sideCut, material( 'side' + i, sideCut ), 'side', sideScale, side.holder, side.gemPosition, side.gemRotationY );
			reach = Math.max( reach, angle + side.halfAngle );

		} );

	}

	if ( d.style === 'cathedral' ) cathedralArches( { parent: ring, metal, surface, head, profile: k } );

	// Pavé on the shoulders, after the last stone of the head
	if ( d.pave.count > 0 ) {

		// start is the center of the first stone
		const r = scaleForCarat( d.pave.weight ) * 1.02;
		const plan = paveLayout( surface, d.pave, reach + arc( surface, r + 0.012 ) );
		const small = makeCut( 'brilliant' ); // own mesh: the viewer disposes meshes on rebuild
		const mat = material( 'pave', small );

		for ( const s of plan.seats ) {

			const m = new Mesh( small.geometry, mat );
			m.position.copy( s.gemPosition );
			m.quaternion.copy( s.quaternion );
			m.scale.setScalar( s.scale );
			m.castShadow = false;
			ring.add( m );
			gems.push( { mesh: m, group: 'pave', cut: small, scale: s.scale } );

		}

		const grains = grainGeometry( plan.seats );
		if ( grains ) addMetal( grains, ring, metal, false );

	}

	if ( d.band.edge === 'beaded' ) addMetal( beadGeometry( surface ), ring, bandMetal, false );

	return { ring, gems };

}

// own metal for tests without the viewer
export const testMetal = () => new MeshPhysicalNodeMaterial( { metalness: 1, roughness: 0.05, color: new Color( METALS.platinum.color ) } );
