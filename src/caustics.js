// SPDX-License-Identifier: AGPL-3.0-or-later
// Caustics by photon splatting, purely rasterised:
// For each stone a point grid is drawn from the light direction. The vertex shader refracts
// every photon through the real facets, follows the total internal reflections to the exit
// and places the point where the ray hits the floor. Summed additively this gives the light
// patterns. Every third point carries red, green or blue with its own refractive index.
import {
	Scene, OrthographicCamera, RenderTarget, HalfFloatType, LinearFilter, NearestFilter, Points, BufferGeometry,
	Float32BufferAttribute, NodeMaterial, AdditiveBlending, CustomBlending, MaxEquation, OneFactor, DoubleSide,
	Mesh, Vector3, QuadMesh, Color
} from 'three';
import {
	Fn, Loop, If, Break, vec2, vec3, vec4, float, int, uniform, positionGeometry, positionWorld,
	modelWorldMatrix, modelWorldMatrixInverse, dot, max, normalize, cross, refract, reflect,
	exp, length, abs, select, varyingProperty, texture, smoothstep, uv
} from 'three/tsl';

// Height map of the metal from above: red = highest, green = lowest metal height per floor
// point, shifted by H0 so that empty places (0) never count as metal and everything stays positive
const H0 = 2;
const STEPS = 8;
import { shared, exitConvex, schlick, absorbPerUnit } from './gem.js';

const _color = new Color();

function gridGeometry( n ) {

	const a = new Float32Array( n * n * 3 );
	let k = 0;

	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		a[ k ++ ] = ( i + 0.5 ) / n * 2 - 1;
		a[ k ++ ] = ( j + 0.5 ) / n * 2 - 1;
		a[ k ++ ] = ( i + j ) % 3; // colour channel, distributed in a checkerboard pattern instead of by column

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( a, 3 ) );
	return g;

}

export class Caustics {

	constructor( renderer, { size = 1024, extent = 4.5 } = {} ) {

		this.renderer = renderer;
		this.size = size;
		this.extent = uniform( extent );
		this.center = uniform( new Vector3() );
		this.gain = uniform( 1 );
		this.perPhoton = uniform( 1 );
		this.scene = new Scene();
		this.camera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this.target = new RenderTarget( size, size, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter } );
		// second texture: smoothed version that the floor samples
		this.smooth = new RenderTarget( size, size, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter } );
		const blur = new NodeMaterial();
		const tx = 1 / size;
		let acc = vec3( 0 ), total = 0;

		for ( let y = - 2; y <= 2; y ++ ) for ( let x = - 2; x <= 2; x ++ ) {

			const wgt = Math.exp( - ( x * x + y * y ) / 3.2 );
			acc = acc.add( texture( this.target.texture, uv().add( vec2( x * tx * 1.3, y * tx * 1.3 ) ) ).rgb.mul( wgt ) );
			total += wgt;

		}

		blur.fragmentNode = vec4( acc.div( total ), 1 );
		this.quad = new QuadMesh( blur );

		// Prongs, setting and band block photons: on the way from the lamp to the stone and from
		// the stone to the floor. For this, a height map of the metal: per column above the floor
		// the highest and lowest metal height. A column counts as full between the two; good
		// enough for prongs and band.
		this.heights = new RenderTarget( 512, 512, { type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter } );
		this.heightScene = new Scene();
		this.occluders = [];
		const hm = new NodeMaterial();
		hm.vertexNode = Fn( () => {

			const pW = modelWorldMatrix.mul( vec4( positionGeometry, 1 ) ).xyz;
			const ndc = pW.xz.sub( this.center.xz ).div( this.extent );
			return vec4( ndc.x, ndc.y, 0.5, 1 );

		} )();
		hm.fragmentNode = vec4( positionWorld.y.add( H0 ), float( H0 ).sub( positionWorld.y ), 0, 1 );
		hm.blending = CustomBlending;
		hm.blendEquation = hm.blendEquationAlpha = MaxEquation;
		hm.blendSrc = hm.blendDst = hm.blendSrcAlpha = hm.blendDstAlpha = OneFactor;
		hm.side = DoubleSide;
		hm.depthTest = false;
		hm.depthWrite = false;
		this.heightMaterial = hm;

		this.items = [];
		this.materials = new Map();
		this.grids = {};
		this.setGrid( 128 );
		this.dirty = true;

	}

	setGrid( n ) {

		this.grid = n;
		if ( ! this.grids[ n ] ) this.grids[ n ] = gridGeometry( n );
		for ( const it of this.items ) it.points.geometry = this.grids[ n ];
		// Flux per photon, converted to the texel area of the caustics texture
		const texel = ( 2 * this.extent.value ) / this.size;
		this.perPhoton.value = 4 / ( n * n ) / ( texel * texel );
		this.dirty = true;

	}

	_material( gemMaterial ) {

		if ( this.materials.has( gemMaterial ) ) return this.materials.get( gemMaterial );

		const { planes, planeCount, ior, disp, absorb, radius } = gemMaterial;
		// Bounding radius as a uniform: a cut change needs no new shader
		const R = radius.mul( 1.01 );
		const energy = varyingProperty( 'vec3', 'vEnergy' );

		// 1 if the path from p0 in direction dir over the length len passes through metal.
		// Sampled at STEPS points, the start point itself does not count.
		const blocked = ( p0, dir, len ) => {

			let b = float( 0 );

			for ( let k = 1; k <= STEPS; k ++ ) {

				const p = p0.add( dir.mul( len.mul( k / STEPS ) ) );
				const uvc = p.xz.sub( this.center.xz ).div( this.extent ).mul( 0.5 ).add( 0.5 );
				const h = texture( this.heights.texture, vec2( uvc.x, uvc.y.oneMinus() ) ).level( 0 );
				const inside = p.y.lessThan( h.r.sub( H0 + 0.004 ) ).and( p.y.greaterThan( float( H0 + 0.004 ).sub( h.g ) ) );
				b = b.max( select( inside, float( 1 ), float( 0 ) ) );

			}

			return b;

		};
		const m = new NodeMaterial();
		m.blending = AdditiveBlending;
		m.transparent = true;
		m.depthTest = false;
		m.depthWrite = false;

		m.vertexNode = Fn( () => {

			const g = positionGeometry.xy;
			const L = normalize( modelWorldMatrixInverse.mul( vec4( shared.lightDir.xyz, 0 ) ).xyz ); // toward the lamp, local
			const up = select( abs( L.y ).lessThan( 0.99 ), vec3( 0, 1, 0 ), vec3( 1, 0, 0 ) );
			const ax = normalize( cross( up, L ) );
			const bx = cross( L, ax );
			const o = ax.mul( g.x ).add( bx.mul( g.y ) ).mul( R ).add( L.mul( R.mul( 3 ) ) ).toVar();
			const d = L.negate().toVar();

			const ch = positionGeometry.z;
			// same dispersion as in the stone
			const n = ior.add( disp.mul( shared.fire ).mul( 0.5 ).mul( ch.sub( 1 ) ) );
			const f0 = n.sub( 1 ).div( n.add( 1 ) ).pow( 2 );

			// entry into the convex body
			const tIn = float( - 1e9 ).toVar(), tEx = float( 1e9 ).toVar();
			const nIn = vec3( 0, 1, 0 ).toVar();
			const miss = float( 0 ).toVar();

			Loop( { start: int( 0 ), end: planeCount, type: 'int' }, ( { i } ) => {

				const p = planes.element( i );
				const dn = dot( p.xyz, d );
				const dist = p.w.sub( dot( p.xyz, o ) );

				If( dn.lessThan( - 1e-5 ), () => {

					const t = dist.div( dn );
					If( t.greaterThan( tIn ), () => { tIn.assign( t ); nIn.assign( p.xyz ); } );

				} ).ElseIf( dn.greaterThan( 1e-5 ), () => {

					tEx.assign( tEx.min( dist.div( dn ) ) );

				} ).Else( () => {

					If( dist.lessThan( 0 ), () => { miss.assign( 1 ); } );

				} );

			} );

			const w = float( 0 ).toVar();
			const dOut = vec3( 0, - 1, 0 ).toVar();
			const path = float( 0 ).toVar();
			const enter = vec3( 0 ).toVar();

			If( tIn.lessThan( tEx ).and( miss.lessThan( 0.5 ) ), () => {

				o.addAssign( d.mul( tIn ) );
				enter.assign( o );
				const F = schlick( max( dot( d.negate(), nIn ), 0 ), f0 );
				w.assign( F.oneMinus() );
				d.assign( refract( d, nIn, float( 1 ).div( n ) ) );
				o.addAssign( nIn.mul( - 1e-4 ) );

				const t = float( 0 ).toVar();
				const nh = vec3( 0, 1, 0 ).toVar();
				const done = float( 0 ).toVar();

				Loop( { start: int( 0 ), end: int( 10 ), type: 'int' }, () => {

					exitConvex( planes, planeCount, o, d, t, nh );
					o.addAssign( d.mul( t ) );
					path.addAssign( t );
					const r = refract( d, nh.negate(), n );

					If( dot( r, r ).greaterThan( 1e-4 ), () => {

						w.mulAssign( schlick( dot( r, nh ), f0 ).oneMinus() );
						dOut.assign( r );
						done.assign( 1 );
						Break();

					} );

					d.assign( reflect( d, nh ) );
					o.addAssign( nh.mul( - 1e-4 ) );

				} );

				w.mulAssign( done );

			} );

			// into the world and onto the floor (y = 0)
			const pW = modelWorldMatrix.mul( vec4( o, 1 ) ).xyz;
			const dW = normalize( modelWorldMatrix.mul( vec4( dOut, 0 ) ).xyz );
			const s = length( modelWorldMatrix.mul( vec4( 1, 0, 0, 0 ) ).xyz );
			const down = dW.y.lessThan( - 0.03 );
			const tG = pW.y.div( dW.y.negate().max( 1e-3 ) );
			const hit = pW.add( dW.mul( tG ) );
			const ndc = hit.xz.sub( this.center.xz ).div( this.extent );

			// metal between lamp and entry or between exit and floor
			const enterW = modelWorldMatrix.mul( vec4( enter, 1 ) ).xyz;
			const shade = blocked( enterW, shared.lightDir.xyz, float( 2 ) ).max( blocked( pW, dW, tG.min( 3 ) ) );
			w.mulAssign( shade.oneMinus() );

			const sigma = absorbPerUnit( absorb );
			const chan = select( ch.lessThan( 0.5 ), vec3( 3, 0, 0 ), select( ch.lessThan( 1.5 ), vec3( 0, 3, 0 ), vec3( 0, 0, 3 ) ) );
			// widely scattered photons are too sparse and would show up as dots
			const fade = smoothstep( 0.8, 1.0, length( ndc ) ).oneMinus().mul( smoothstep( 0.5, 1.9, tG ).oneMinus() );
			energy.assign( chan.mul( exp( sigma.mul( path ).negate() ) ).mul( w ).mul( s.mul( s ).mul( R ).mul( R ) ).mul( this.perPhoton ).mul( fade ) );

			const ok = down.and( w.greaterThan( 1e-4 ) );
			return select( ok, vec4( ndc.x, ndc.y, 0.5, 1 ), vec4( 2, 2, 2, 1 ) );

		} )();

		m.fragmentNode = vec4( energy, 1 );

		this.materials.set( gemMaterial, m );
		return m;

	}

	add( mesh, gemMaterial ) {

		const points = new Points( this.grids[ this.grid ], this._material( gemMaterial ) );
		points.frustumCulled = false;
		points.matrixAutoUpdate = false;
		points.matrixWorldAutoUpdate = false;
		this.scene.add( points );
		this.items.push( { mesh, points } );

	}

	// Metal part that blocks photons. A copy with the same geometry draws it into the height
	// map, the position is taken from the original on every update.
	addOccluder( mesh ) {

		const copy = new Mesh( mesh.geometry, this.heightMaterial );
		copy.frustumCulled = false;
		copy.matrixAutoUpdate = false;
		copy.matrixWorldAutoUpdate = false;
		this.heightScene.add( copy );
		this.occluders.push( { mesh, copy } );
		this.dirty = true;

	}

	// Remove the stones and occluders of another ring. The photon materials stay: the ring
	// editor rebuilds with the same stone materials, their shaders must not be rebuilt.
	clear() {

		for ( const { points } of this.items ) this.scene.remove( points );
		for ( const { copy } of this.occluders ) this.heightScene.remove( copy );
		this.items = [];
		this.occluders = [];
		this.dirty = true;

	}

	// Release the photon material of a disposed stone material
	forget( gemMaterial ) {

		this.materials.get( gemMaterial )?.dispose();
		this.materials.delete( gemMaterial );

	}

	update() {

		if ( ! this.dirty ) return;
		this.dirty = false;

		for ( const { mesh, points } of this.items ) points.matrixWorld.copy( mesh.matrixWorld );
		for ( const { mesh, copy } of this.occluders ) copy.matrixWorld.copy( mesh.matrixWorld );

		const r = this.renderer;
		const prev = r.getRenderTarget();
		const mrt = r.getMRT();
		r.setMRT( null );
		const clearColor = r.getClearColor( _color ), clearAlpha = r.getClearAlpha();
		r.setClearColor( 0x000000, 0 );
		r.setRenderTarget( this.heights );
		r.render( this.heightScene, this.camera );
		r.setRenderTarget( this.target );
		r.setClearColor( 0x000000, 1 );
		r.render( this.scene, this.camera );
		r.setRenderTarget( this.smooth );
		this.quad.render( r );
		r.setClearColor( clearColor, clearAlpha );
		r.setRenderTarget( prev );
		r.setMRT( mrt );

	}

	// Sampling at the floor
	sample( posW ) {

		const uvc = posW.xz.sub( this.center.xz ).div( this.extent ).mul( 0.5 ).add( 0.5 );
		const edge = uvc.sub( 0.5 ).abs();
		const inside = smoothstep( 0.45, 0.5, edge.x.max( edge.y ) ).oneMinus();
		// Image row 0 of the target texture is at the top, so flip v
		return texture( this.smooth.texture, vec2( uvc.x, uvc.y.oneMinus() ) ).rgb.mul( inside ).mul( this.gain );

	}

}
