// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks all cuts in CUTS: build, plane count, closed mesh, volume, girdle, width, prong directions and reference values of brilliant and emerald.
// Start: node --import ./tools/three-hook.mjs tools/cuttest.mjs
import { CUTS, MAX_PLANES, makeCut, cutPlanes, supportRadius, cutVolume, prongDirs } from '../src/gemcut.js';

let errors = 0;

const check = ( ok, text ) => {

	console.log( ( ok ? 'ok      ' : 'FAIL    ' ) + text );
	if ( ! ok ) errors ++;

};

// Expected number of prongs per cut
const PRONGS = { brilliant: 4, oval: 4, marquise: 4, pear: 4, cushion: 4, princess: 4, emerald: 4, asscher: 4, radiant: 4, baguette: 4, trillion: 3, 'old-european': 4, 'old-mine': 4, rose: 6, hexagon: 6, kite: 4 };

// Planes (nx, ny, nz, d) of the standard cuts, rounded to five decimals
const REFERENCE = {
	brilliant: [
		[ 0, 1, 0, 0.3374 ],
		[ 0.56641, 0.82413, 0, 0.59525 ],
		[ 0.65474, -0.75585, 0, 0.6812 ],
		[ 0.35801, 0.92187, 0.14829, 0.51153 ],
		[ 0.40051, 0.82413, 0.40051, 0.59525 ],
		[ 0.46297, -0.75585, 0.46297, 0.6812 ],
		[ 0.14829, 0.92187, 0.35801, 0.51153 ],
		[ 0, 0.82413, 0.56641, 0.59525 ],
		[ 0, -0.75585, 0.65474, 0.6812 ],
		[ -0.14829, 0.92187, 0.35801, 0.51153 ],
		[ -0.40051, 0.82413, 0.40051, 0.59525 ],
		[ -0.46297, -0.75585, 0.46297, 0.6812 ],
		[ -0.35801, 0.92187, 0.14829, 0.51153 ],
		[ -0.56641, 0.82413, 0, 0.59525 ],
		[ -0.65474, -0.75585, 0, 0.6812 ],
		[ -0.35801, 0.92187, -0.14829, 0.51153 ],
		[ -0.40051, 0.82413, -0.40051, 0.59525 ],
		[ -0.46297, -0.75585, -0.46297, 0.6812 ],
		[ -0.14829, 0.92187, -0.35801, 0.51153 ],
		[ 0, 0.82413, -0.56641, 0.59525 ],
		[ 0, -0.75585, -0.65474, 0.6812 ],
		[ 0.14829, 0.92187, -0.35801, 0.51153 ],
		[ 0.40051, 0.82413, -0.40051, 0.59525 ],
		[ 0.46297, -0.75585, -0.46297, 0.6812 ],
		[ 0.35801, 0.92187, -0.14829, 0.51153 ],
		[ 0.62058, 0.77437, 0.12344, 0.65984 ],
		[ 0.64829, -0.75039, 0.12895, 0.68726 ],
		[ 0.5261, 0.77437, 0.35153, 0.65984 ],
		[ 0.5496, -0.75039, 0.36723, 0.68726 ],
		[ 0.35153, 0.77437, 0.5261, 0.65984 ],
		[ 0.36723, -0.75039, 0.5496, 0.68726 ],
		[ 0.12344, 0.77437, 0.62058, 0.65984 ],
		[ 0.12895, -0.75039, 0.64829, 0.68726 ],
		[ -0.12344, 0.77437, 0.62058, 0.65984 ],
		[ -0.12895, -0.75039, 0.64829, 0.68726 ],
		[ -0.35153, 0.77437, 0.5261, 0.65984 ],
		[ -0.36723, -0.75039, 0.5496, 0.68726 ],
		[ -0.5261, 0.77437, 0.35153, 0.65984 ],
		[ -0.5496, -0.75039, 0.36723, 0.68726 ],
		[ -0.62058, 0.77437, 0.12344, 0.65984 ],
		[ -0.64829, -0.75039, 0.12895, 0.68726 ],
		[ -0.62058, 0.77437, -0.12344, 0.65984 ],
		[ -0.64829, -0.75039, -0.12895, 0.68726 ],
		[ -0.5261, 0.77437, -0.35153, 0.65984 ],
		[ -0.5496, -0.75039, -0.36723, 0.68726 ],
		[ -0.35153, 0.77437, -0.5261, 0.65984 ],
		[ -0.36723, -0.75039, -0.5496, 0.68726 ],
		[ -0.12344, 0.77437, -0.62058, 0.65984 ],
		[ -0.12895, -0.75039, -0.64829, 0.68726 ],
		[ 0.12344, 0.77437, -0.62058, 0.65984 ],
		[ 0.12895, -0.75039, -0.64829, 0.68726 ],
		[ 0.35153, 0.77437, -0.5261, 0.65984 ],
		[ 0.36723, -0.75039, -0.5496, 0.68726 ],
		[ 0.5261, 0.77437, -0.35153, 0.65984 ],
		[ 0.5496, -0.75039, -0.36723, 0.68726 ],
		[ 0.62058, 0.77437, -0.12344, 0.65984 ],
		[ 0.64829, -0.75039, -0.12895, 0.68726 ],
		[ 0.98079, 0, 0.19509, 1 ],
		[ 0.83147, 0, 0.55557, 1 ],
		[ 0.55557, 0, 0.83147, 1 ],
		[ 0.19509, 0, 0.98079, 1 ],
		[ -0.19509, 0, 0.98079, 1 ],
		[ -0.55557, 0, 0.83147, 1 ],
		[ -0.83147, 0, 0.55557, 1 ],
		[ -0.98079, 0, 0.19509, 1 ],
		[ -0.98079, 0, -0.19509, 1 ],
		[ -0.83147, 0, -0.55557, 1 ],
		[ -0.55557, 0, -0.83147, 1 ],
		[ -0.19509, 0, -0.98079, 1 ],
		[ 0.19509, 0, -0.98079, 1 ],
		[ 0.55557, 0, -0.83147, 1 ],
		[ 0.83147, 0, -0.55557, 1 ],
		[ 0.98079, 0, -0.19509, 1 ]
	],
	emerald: [
		[ 0, 1, 0, 0.36836 ],
		[ 1, 0, 0, 1 ],
		[ 0.84805, 0.52992, 0, 0.86924 ],
		[ 0.66913, 0.74314, 0, 0.76648 ],
		[ 0.46947, 0.88295, 0, 0.66326 ],
		[ 0.88295, -0.46947, 0, 0.90173 ],
		[ 0.73135, -0.682, 0, 0.86889 ],
		[ 0.54464, -0.83867, 0, 0.86276 ],
		[ -1, 0, 0, 1 ],
		[ -0.84805, 0.52992, 0, 0.86924 ],
		[ -0.66913, 0.74314, 0, 0.76648 ],
		[ -0.46947, 0.88295, 0, 0.66326 ],
		[ -0.88295, -0.46947, 0, 0.90173 ],
		[ -0.73135, -0.682, 0, 0.86889 ],
		[ -0.54464, -0.83867, 0, 0.86276 ],
		[ 0, 0, 1, 1.38 ],
		[ 0, 0.52992, 0.84805, 1.1915 ],
		[ 0, 0.74314, 0.66913, 1.02075 ],
		[ 0, 0.88295, 0.46947, 0.84166 ],
		[ 0, -0.46947, 0.88295, 1.23725 ],
		[ 0, -0.682, 0.73135, 1.14681 ],
		[ 0, -0.83867, 0.54464, 1.06972 ],
		[ 0, 0, -1, 1.38 ],
		[ 0, 0.52992, -0.84805, 1.1915 ],
		[ 0, 0.74314, -0.66913, 1.02075 ],
		[ 0, 0.88295, -0.46947, 0.84166 ],
		[ 0, -0.46947, -0.88295, 1.23725 ],
		[ 0, -0.682, -0.73135, 1.14681 ],
		[ 0, -0.83867, -0.54464, 1.06972 ],
		[ 0.70711, 0, 0.70711, 1.28693 ],
		[ 0.59966, 0.52992, 0.59966, 1.11258 ],
		[ 0.47315, 0.74314, 0.47315, 0.95847 ],
		[ 0.33197, 0.88295, 0.33197, 0.79797 ],
		[ 0.62434, -0.46947, 0.62434, 1.15507 ],
		[ 0.51715, -0.682, 0.51715, 1.07874 ],
		[ 0.38512, -0.83867, 0.38512, 1.01904 ],
		[ -0.70711, 0, 0.70711, 1.28693 ],
		[ -0.59966, 0.52992, 0.59966, 1.11258 ],
		[ -0.47315, 0.74314, 0.47315, 0.95847 ],
		[ -0.33197, 0.88295, 0.33197, 0.79797 ],
		[ -0.62434, -0.46947, 0.62434, 1.15507 ],
		[ -0.51715, -0.682, 0.51715, 1.07874 ],
		[ -0.38512, -0.83867, 0.38512, 1.01904 ],
		[ 0.70711, 0, -0.70711, 1.28693 ],
		[ 0.59966, 0.52992, -0.59966, 1.11258 ],
		[ 0.47315, 0.74314, -0.47315, 0.95847 ],
		[ 0.33197, 0.88295, -0.33197, 0.79797 ],
		[ 0.62434, -0.46947, -0.62434, 1.15507 ],
		[ 0.51715, -0.682, -0.51715, 1.07874 ],
		[ 0.38512, -0.83867, -0.38512, 1.01904 ],
		[ -0.70711, 0, -0.70711, 1.28693 ],
		[ -0.59966, 0.52992, -0.59966, 1.11258 ],
		[ -0.47315, 0.74314, -0.47315, 0.95847 ],
		[ -0.33197, 0.88295, -0.33197, 0.79797 ],
		[ -0.62434, -0.46947, -0.62434, 1.15507 ],
		[ -0.51715, -0.682, -0.51715, 1.07874 ],
		[ -0.38512, -0.83867, -0.38512, 1.01904 ]
	]
};

const r5 = ( v ) => Math.round( v * 1e5 ) / 1e5;

// Match vertices by rounded coordinates (neighbor cells checked too)
function vertexIndex() {

	const cells = new Map();
	let n = 0;

	return ( x, y, z ) => {

		const cx = Math.round( x * 1e3 ), cy = Math.round( y * 1e3 ), cz = Math.round( z * 1e3 );

		for ( let a = - 1; a <= 1; a ++ ) for ( let b = - 1; b <= 1; b ++ ) for ( let c = - 1; c <= 1; c ++ ) {

			for ( const q of cells.get( ( cx + a ) + ',' + ( cy + b ) + ',' + ( cz + c ) ) || [] ) {

				if ( Math.hypot( q.x - x, q.y - y, q.z - z ) < 1e-4 ) return q.i;

			}

		}

		const k = cx + ',' + cy + ',' + cz;
		if ( ! cells.has( k ) ) cells.set( k, [] );
		cells.get( k ).push( { x, y, z, i: n } );
		return n ++;

	};

}

// Edges by the number of their triangles and area per plane
function meshInfo( cut ) {

	const p = cut.geometry.attributes.position.array, nm = cut.geometry.attributes.normal.array;
	const id = vertexIndex(), edges = new Map(), tris = [];
	let degenerate = 0;

	for ( let i = 0; i < p.length; i += 9 ) {

		const v = [ 0, 3, 6 ].map( o => id( p[ i + o ], p[ i + o + 1 ], p[ i + o + 2 ] ) );
		if ( v[ 0 ] === v[ 1 ] || v[ 1 ] === v[ 2 ] || v[ 0 ] === v[ 2 ] ) degenerate ++;

		for ( let k = 0; k < 3; k ++ ) {

			const a = v[ k ], b = v[ ( k + 1 ) % 3 ], s = a < b ? a + '_' + b : b + '_' + a;
			edges.set( s, ( edges.get( s ) || 0 ) + 1 );

		}

		const ux = p[ i + 3 ] - p[ i ], uy = p[ i + 4 ] - p[ i + 1 ], uz = p[ i + 5 ] - p[ i + 2 ];
		const wx = p[ i + 6 ] - p[ i ], wy = p[ i + 7 ] - p[ i + 1 ], wz = p[ i + 8 ] - p[ i + 2 ];
		const fl = Math.hypot( uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx ) / 2;
		tris.push( { nx: nm[ i ], ny: nm[ i + 1 ], nz: nm[ i + 2 ], d: nm[ i ] * p[ i ] + nm[ i + 1 ] * p[ i + 1 ] + nm[ i + 2 ] * p[ i + 2 ], fl } );

	}

	return { edges, tris, degenerate };

}

const NAMES = 'brilliant Brilliant, oval Oval, marquise Marquise, pear Pear, cushion Cushion, princess Princess, emerald Emerald, asscher Asscher, radiant Radiant, baguette Baguette, trillion Trillion, old-european Old European, old-mine Old mine, rose Rose, hexagon Hexagon, kite Kite';
check( CUTS.map( c => c.id + ' ' + c.name ).join( ', ' ) === NAMES, 'CUTS: ' + CUTS.length + ' cuts in order with English names' );

for ( const { id } of CUTS ) {

	let cut, raw;

	try {

		raw = cutPlanes( id );
		cut = makeCut( id );

	} catch ( e ) {

		check( false, id + ': build (' + e.message + ')' );
		continue;

	}

	const n = cut.planes.length;
	check( cut.kind === id && Number.isFinite( cut.minY ) && Number.isFinite( cut.maxY ) && cut.minY < 0 && cut.maxY > 0, id + ': kind, minY ' + cut.minY.toFixed( 3 ) + ', maxY ' + cut.maxY.toFixed( 3 ) );
	check( n <= MAX_PLANES, id + ': ' + n + ' visible planes (at most ' + MAX_PLANES + ')' );

	const { edges, tris, degenerate } = meshInfo( cut );
	const bad = [ ...edges.values() ].filter( c => c !== 2 ).length;
	check( bad === 0 && degenerate === 0, id + ': mesh closed (' + edges.size + ' edges' + ( bad ? ', ' + bad + ' not shared by two triangles' : '' ) + ( degenerate ? ', ' + degenerate + ' degenerate triangles' : '' ) + ')' );

	const vol = cutVolume( cut );
	check( vol > 0, id + ': volume ' + vol.toFixed( 4 ) );

	let smallest = Infinity;
	for ( const p of cut.planes ) {

		let f = 0;
		for ( const t of tris ) if ( Math.abs( t.nx * p.x + t.ny * p.y + t.nz * p.z - 1 ) < 1e-5 && Math.abs( t.d - p.w ) < 1e-4 ) f += t.fl;
		smallest = Math.min( smallest, f );

	}
	check( raw.length === n && smallest > 1e-4, id + ': all ' + raw.length + ' planes carry facets (smallest area ' + smallest.toFixed( 5 ) + ')' );

	let closest = Infinity;
	for ( let a = 0; a < 360; a += 2 ) closest = Math.min( closest, supportRadius( cut.planes, a * Math.PI / 180, 0 ) );
	check( closest > 0.3, id + ': girdle at y = 0, smallest distance ' + closest.toFixed( 3 ) );

	const width = supportRadius( cut.planes, 0, 0 );
	check( width > 0.95 && width < 1.05, id + ': half width in X ' + width.toFixed( 3 ) );

	const dirs = prongDirs( id );
	const rmin = Math.min( ...dirs.map( a => supportRadius( cut.planes, a, 0 ) ) );
	check( dirs.length === PRONGS[ id ] && rmin > 0 && Number.isFinite( rmin ), id + ': ' + dirs.length + ' prongs at ' + dirs.map( a => Math.round( a * 180 / Math.PI ) + '°' ).join( ' ' ) + ', distance from ' + rmin.toFixed( 3 ) );

}

// Standard cuts match the reference
for ( const id of [ 'brilliant', 'emerald' ] ) {

	const actual = makeCut( id ).planes.map( p => [ p.x, p.y, p.z, p.w ].map( r5 ) );
	const expected = REFERENCE[ id ];
	const same = actual.length === expected.length && actual.every( ( p, i ) => p.every( ( v, k ) => Math.abs( v - expected[ i ][ k ] ) < 2e-5 ) );
	check( same, id + ': standard planes match the reference (' + actual.length + ' of ' + expected.length + ')' );

}

console.log( errors ? errors + ' errors' : 'all passed' );
process.exit( errors ? 1 : 0 );
