// SPDX-License-Identifier: AGPL-3.0-or-later
// Demo script for tools/video.mjs, two parts of about 43 seconds each:
// light: platinum in the light tent. Orbit in the overview, light panel with a circling light,
//   macro across the head, slow orbit at medium distance.
// dark: yellow gold on black. Flat orbit with floor reflection, close to the smooth band
//   with travelling light streaks, along the pavé to the center stone, center stone from the front.
window.demoScript = ( () => {

	const v = window.viewer;
	const $ = ( s ) => document.querySelector( s );
	const DEG = Math.PI / 180;
	let base; // camera of view 1: target t, direction az, elevation el, distance d
	let C, S, P; // center stone, side stones [left, right], pavé { l: [0..6], r: [0..6] } from inside to outside
	let Smooth; // smooth band behind the right pavé row
	let last = {};

	// Only the image, light gizmo and light panel stay visible, all other controls are hidden
	const CSS = 'body > :not(#view):not(#gizmo):not(#light-panel) { display: none !important; }';

	// Direction 0° = from the front onto the head (+Z), elevation in degrees above the horizontal
	const setCamera = ( k ) => {

		const a = k.az * DEG, e = k.el * DEG;
		v.controls.target.set( k.tx, k.ty, k.tz );
		v.camera.position.set( k.tx + k.d * Math.sin( a ) * Math.cos( e ), k.ty + k.d * Math.sin( e ), k.tz + k.d * Math.cos( a ) * Math.cos( e ) );
		v.controls.update();

	};

	// Keyframes as a monotone cubic curve: the camera moves through all points without jerks and
	// without overshoot. A field without a new value stays put. Everything rests at start and end.
	const FIELDS = [ 'az', 'el', 'd', 'tx', 'ty', 'tz', 'laz', 'lel', 'env' ];
	const track = ( raw ) => {

		const keys = [];
		for ( const k of raw ) keys.push( { ...( keys.length ? keys[ keys.length - 1 ] : {} ), ...k } );
		const tan = ( i, f ) => {

			if ( i <= 0 || i >= keys.length - 1 ) return 0;
			const d0 = ( keys[ i ][ f ] - keys[ i - 1 ][ f ] ) / ( keys[ i ].t - keys[ i - 1 ].t );
			const d1 = ( keys[ i + 1 ][ f ] - keys[ i ][ f ] ) / ( keys[ i + 1 ].t - keys[ i ].t );
			return d0 * d1 <= 0 ? 0 : 2 * d0 * d1 / ( d0 + d1 );

		};

		return ( t ) => {

			let i = 0;
			while ( i < keys.length - 2 && t >= keys[ i + 1 ].t ) i ++;
			const a = keys[ i ], b = keys[ i + 1 ], h = b.t - a.t;
			const s = Math.min( Math.max( ( t - a.t ) / h, 0 ), 1 ), s2 = s * s, s3 = s2 * s;
			const out = {};
			for ( const f of FIELDS ) out[ f ] = ( 2 * s3 - 3 * s2 + 1 ) * a[ f ] + ( s3 - 2 * s2 + s ) * h * tan( i, f ) + ( 3 * s2 - 2 * s3 ) * b[ f ] + ( s3 - s2 ) * h * tan( i + 1, f );
			return out;

		};

	};

	const at = ( p, dx = 0, dy = 0, dz = 0 ) => ( { tx: p.x + dx, ty: p.y + dy, tz: p.z + dz } );
	const mix = ( a, b, s ) => a.clone().lerp( b, s );
	// Direction from the ring center through p, pointing outward
	const outward = ( p ) => Math.atan2( p.x - base.t.x, p.z - base.t.z ) / DEG;

	const parts = {

		light: {

			duration: 42.7, dark: false, metal: 'platinum', focus: false,
			panel: [ 9.6, 21.6 ],
			build() {

				const B = base, middle = mix( B.t, C, 0.6 );
				return track( [
					{ t: 0, az: B.az - 75, el: 12, d: B.d * 1.02, ...at( B.t ), laz: 40, lel: 55, env: 0 },
					{ t: 4.5, az: B.az - 35, el: 16, d: B.d * 0.97 },
					{ t: 9, az: B.az, el: B.el, d: B.d },
					// The light circles the ring once, the camera stays put
					{ t: 10 },
					{ t: 13.5, laz: 160, lel: 35 },
					{ t: 17.5, laz: 290, lel: 62 },
					{ t: 21, laz: 400, lel: 55 },
					{ t: 21.6 },
					{ t: 24.3, az: B.az - 18, el: B.el + 7, d: B.d * 1.32 },
					// Macro across the head
					{ t: 25.4, az: 22, el: 22, d: 1.95, ...at( C, - 0.22, 0.04, 0.12 ) },
					{ t: 29.6, az: - 12, el: 30, d: 1.7, ...at( C, 0.2, 0.08, 0.12 ) },
					// Back to medium distance, slow orbit
					{ t: 31, az: 40, el: 22, d: 4.3, ...at( middle ) },
					{ t: 42.7, az: - 75, el: 27 }
				] );

			}

		},

		dark: {

			duration: 42.7, dark: true, metal: 'yellowgold', focus: true,
			build() {

				const B = base, R = P.r, near = ( p, dAz, el, d ) => ( { az: outward( p ) + dAz, el, d, ...at( p ) } );
				return track( [
					// Flat orbit with reflection in the floor
					{ t: 0, az: - 150, el: 8, d: B.d * 0.78, ...at( B.t ), laz: 40, lel: 55, env: 0 },
					{ t: 5.25, az: - 28, el: 10 },
					{ t: 10.5, az: 95, el: 11 },
					// Close to the smooth band, the light streaks travel in long gradients over the gold
					{ t: 12, ...near( Smooth, 40, 8, 1.1 ) },
					{ t: 17.5, az: outward( Smooth ) + 50, env: 80 },
					// Along the pavé row inward
					{ t: 18.5, ...near( R[ 6 ], 30, 7, 1.0 ) },
					{ t: 21.5, ...near( R[ 4 ], 30, 8, 1.0 ), env: 105 },
					{ t: 24.5, ...near( R[ 2 ], 30, 9, 1.0 ), env: 125 },
					{ t: 27.5, ...near( R[ 0 ], 28, 10, 1.05 ), env: 140 },
					// Over the side stone to the center stone
					{ t: 30.5, ...near( S[ 1 ], 28, 12, 1.25 ) },
					{ t: 35.5, ...near( mix( S[ 1 ], C, 0.55 ), 20, 16, 1.45 ) },
					{ t: 39.5, az: 0, el: 18, d: 1.9, ...at( C ) },
					{ t: 42.7, az: - 14, el: 20, d: 1.95 }
				] );

			}

		}

	};

	return {

		parts,

		async start( name ) {

			if ( ! document.getElementById( 'demo-script-css' ) ) {

				const st = document.createElement( 'style' );
				st.id = 'demo-script-css';
				st.textContent = CSS;
				document.head.appendChild( st );

			}

			const part = parts[ name ];
			if ( ! part ) throw new Error( 'Unknown part: ' + name );
			// The video shows the default ring with diamonds
			Object.assign( v.state, { center: 'lab-diamond', side: 'lab-diamond' } );
			if ( v.setDesign ) v.setDesign( v.defaultDesign );
			Object.assign( v.state, { dark: part.dark, metal: part.metal, az: 40, el: 55, env: 0 } );
			v.setScene();
			v.setMaterials();
			v.setLight();
			if ( ! $( '#light-panel' ).hidden ) $( '#light' ).click();
			v.syncUI();
			v.goView( 0, true );

			const t = v.controls.target.clone(), off = v.camera.position.clone().sub( t ), d = off.length();
			base = { t, d, az: Math.atan2( off.x, off.z ) / DEG, el: Math.asin( off.y / d ) / DEG };
			const pos = ( g ) => g.mesh.getWorldPosition( t.clone() );
			C = pos( v.gems.find( g => g.group === 'center' ) );
			S = v.gems.filter( g => g.group === 'side' ).map( pos ).sort( ( a, b ) => a.x - b.x );
			const pave = v.gems.filter( g => g.group === 'pave' ).map( pos );
			const row = ( r ) => r.sort( ( a, b ) => b.z - a.z );
			P = { l: row( pave.filter( p => p.x < 0 ) ), r: row( pave.filter( p => p.x > 0 ) ) };
			// Top of the band 115° from the head, on the side of the right pavé row
			const a = 115 * DEG, top = 1.04;
			Smooth = [ 1, - 1 ].map( s => v.ring.localToWorld( t.clone().set( s * Math.sin( a ) * top, Math.cos( a ) * top, 0 ) ) ).find( p => p.x > 0 );

			part.path = part.build();
			this.active = part;
			last = {};
			await this.frame( 0 );

		},

		async frame( t ) {

			const part = this.active, k = part.path( t );
			setCamera( k );
			v.setFocus( part.focus ? v.controls.target.clone() : null );

			// Set the light again only on change: shadows, caustics and probes then recompute
			if ( k.laz !== last.laz || k.lel !== last.lel || k.env !== last.env ) {

				Object.assign( v.state, { az: k.laz, el: k.lel, env: k.env } );
				v.setLight();
				last = { laz: k.laz, lel: k.lel, env: k.env };

			}

			const open = !! part.panel && t >= part.panel[ 0 ] && t < part.panel[ 1 ];
			if ( open === $( '#light-panel' ).hidden ) $( '#light' ).click();
			if ( open ) {

				v.syncUI();
				// Sliders and readout run from -180° to 180° as in the app
				const az = Math.round( ( ( ( k.laz + 180 ) % 360 ) + 360 ) % 360 - 180 ), el = Math.round( k.lel );
				$( '#azv' ).textContent = az + '°';
				$( '#elv' ).textContent = el + '°';
				$( '#az' ).value = az;
				$( '#el' ).value = el;

			}

		}

	};

} )();
