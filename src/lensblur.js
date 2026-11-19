// SPDX-License-Identifier: AGPL-3.0-or-later
// Depth of field like a lens, as a gather filter in a single pass
// (after Dennis Gustafsson, "Bokeh depth of field in a single pass", 2018).
//
// Every pixel samples a Vogel spiral. A neighbour counts only if its own circle of confusion
// reaches this far. Anything behind is limited to the circle of the center. So a sharp stone
// does not scatter into the soft background, and the soft background does not lie over the
// sharp stone. Three's built-in filter mixes both and draws coloured dot rings around sharp
// edges.
//
// Gathering happens at about half CSS resolution, sharp areas come from the full image
// (sharp, otherwise color).
//
// The filter runs after temporal anti-aliasing, so the averaging there does not help it.
// When the image is still, the sampling pattern therefore changes every frame and the filter
// averages its last frames itself (up to 16). restart() begins again as soon as something
// moves; then the pattern stays fixed and nothing trails.
import { Node, NodeMaterial, NodeUpdateType, RenderTarget, Vector2, HalfFloatType, QuadMesh, RendererUtils, LinearFilter } from 'three/webgpu';
import {
	Fn, uniform, texture, uv, vec2, vec4, float, Loop, smoothstep, mix, max, abs, cos, sin, sqrt, fract, dot,
	select, perspectiveDepthToViewZ, convertToTexture, nodeObject, context
} from 'three/tsl';

const _quad = /*@__PURE__*/ new QuadMesh();
let _state;
const GOLDEN = 2.39996323;
const HISTORY = 16;

const target = ( name ) => {

	const rt = new RenderTarget( 1, 1, { depthBuffer: false, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter } );
	rt.texture.name = name;
	return rt;

};

class LensBlurNode extends Node {

	static get type() { return 'LensBlurNode'; }

	// color: image (texture node), depth: depth texture of the scene pass, near/far: camera,
	// focus: focus distance, range: distance to full blur, maxPx: largest radius in pixels
	// of the full image, samples: sample points per pixel, sharp: image for the sharp areas
	// (without the limiting of the highlights)
	constructor( color, depth, near, far, focus, range, maxPx, samples = 96, sharp = null ) {

		super( 'vec4' );
		Object.assign( this, { color, depth, near, far, focus, range, maxPx, samples, sharp } );

		this._invFull = uniform( new Vector2() );
		this._invLow = uniform( new Vector2() );
		this._texel = uniform( 2 ); // pixels of the full image per sample point of the gather stage
		this._rt = target( 'LensBlur' );
		this._lowTex = texture( this._rt.texture );
		this._material = new NodeMaterial();

		// Averaging over several frames: two buffers in alternation
		this._hist = [ target( 'LensBlurA' ), target( 'LensBlurB' ) ];
		this._read = 0;
		this._n = 0;
		this._frame = uniform( 0 ); // offsets the noise per frame
		this._radial = uniform( 0.5 ); // offsets the rings of the spiral per frame
		this._weight = uniform( 1 );
		this._prevTex = texture( this._hist[ 0 ].texture );
		this._outTex = texture( this._hist[ 1 ].texture );
		this._accMaterial = new NodeMaterial();
		this._accMaterial.fragmentNode = mix( this._prevTex.sample( uv() ), this._lowTex.sample( uv() ), this._weight );

		this.updateBeforeType = NodeUpdateType.FRAME;

	}

	restart() {

		this._n = 0;

	}

	setSize( w, h, scale ) {

		this._invFull.value.set( 1 / w, 1 / h );
		const lw = Math.max( 1, Math.round( w * scale ) ), lh = Math.max( 1, Math.round( h * scale ) );
		this._invLow.value.set( 1 / lw, 1 / lh );
		if ( this._rt.width !== lw || this._rt.height !== lh ) this._n = 0;
		this._rt.setSize( lw, lh );
		for ( const rt of this._hist ) rt.setSize( lw, lh );
		this._texel.value = 1 / scale;

	}

	updateBefore( frame ) {

		const { renderer } = frame;
		const img = this.color.value.image;
		// about half CSS resolution: at pixel ratio 2 a quarter of the buffer
		const scale = Math.min( 0.5, Math.max( 0.25, 0.5 / renderer.getPixelRatio() ) );
		this.setSize( img.width, img.height, scale );

		// first frame after a movement: fixed pattern, mix in nothing old
		const n = this._n;
		this._frame.value = n % 64;
		this._radial.value = n === 0 ? 0.5 : ( n * 0.7548777 ) % 1;
		this._weight.value = 1 / ( Math.min( n, HISTORY - 1 ) + 1 );

		_state = RendererUtils.resetRendererState( renderer, _state );
		renderer.setClearColor( 0x000000, 0 );
		_quad.material = this._material;
		_quad.name = 'LensBlur';
		renderer.setRenderTarget( this._rt );
		_quad.render( renderer );

		const write = this._hist[ 1 - this._read ];
		this._prevTex.value = this._hist[ this._read ].texture;
		_quad.material = this._accMaterial;
		_quad.name = 'LensBlurHistory';
		renderer.setRenderTarget( write );
		_quad.render( renderer );
		this._outTex.value = write.texture;
		this._read = 1 - this._read;
		this._n ++;

		RendererUtils.restoreRendererState( renderer, _state );

	}

	setup( builder ) {

		const { color, depth, near, far, focus, range, maxPx } = this;
		const N = this.samples;

		const distAt = ( p ) => perspectiveDepthToViewZ( depth.sample( p ).r, near, far ).negate();
		// Radius of the circle of confusion in pixels of the full image
		const sizeAt = ( d ) => smoothstep( 0, range, abs( d.sub( focus ) ) ).mul( maxPx );

		const gather = Fn( () => {

			const p = uv();
			const cDist = distAt( p ).toVar();
			const cSize = sizeAt( cDist ).toVar();
			const acc = color.sample( p ).rgb.toVar();
			const tot = float( 1 ).toVar();
			const front = float( 0 ).toVar();

			// rotated spiral per pixel (noise after Jimenez): the dot pattern of single sparks
			// becomes fine grain that the final filter smooths
			const px = p.div( this._invLow ).add( this._frame.mul( 5.588238 ) );
			const rot = fract( float( 52.9829189 ).mul( fract( dot( px, vec2( 0.06711056, 0.00583715 ) ) ) ) ).mul( 6.2831853 );
			// half the distance between two sample points: this wide the edge of a circle fades out
			const soft = maxPx.mul( Math.sqrt( Math.PI / N ) * 0.5 ).max( 0.5 );

			Loop( N, ( { i } ) => {

				const fi = float( i );
				const r = sqrt( fi.add( this._radial ).div( N ) ).mul( maxPx );
				const a = fi.mul( GOLDEN ).add( rot );
				const q = p.add( vec2( cos( a ), sin( a ) ).mul( r ).mul( this._invFull ) );

				const sDist = distAt( q );
				const behind = sDist.greaterThan( cDist );
				const sSize = select( behind, sizeAt( sDist ).min( cSize.mul( 2 ) ), sizeAt( sDist ) );
				// Neighbours without their own circle of confusion never count: the soft edge alone
				// would let the coarse image lie over sharp areas at low overall blur
				const m = smoothstep( r.sub( soft ), r.add( soft ), sSize ).mul( smoothstep( 0.3, 1, sSize ) );

				acc.addAssign( mix( acc.div( tot ), color.sample( q ).rgb, m ) );
				front.addAssign( select( behind, float( 0 ), m ) );
				tot.addAssign( 1 );

			} );

			// Alpha: how much blur from the front falls over this point
			return vec4( acc.div( tot ), front.div( tot ) );

		} );

		this._material.contextNode = context( builder.getSharedContext() );
		this._material.fragmentNode = gather();
		this._material.needsUpdate = true;

		// Composite at full size: four offset taps smooth the grain,
		// sharp areas take the full image
		const composite = Fn( () => {

			const p = uv();
			const o = this._invLow.mul( 0.75 );
			const low = this._outTex;
			const b = low.sample( p.add( vec2( o.x.negate(), o.y.negate() ) ) )
				.add( low.sample( p.add( vec2( o.x, o.y.negate() ) ) ) )
				.add( low.sample( p.add( vec2( o.x.negate(), o.y ) ) ) )
				.add( low.sample( p.add( o ) ) ).mul( 0.25 );
			const own = sizeAt( distAt( p ) );
			// Transition in units of the gather stage: smaller blur stays from the full image,
			// otherwise at high pixel density a hint of blur would become a whole coarse pixel
			const w = max( smoothstep( this._texel.mul( 0.4 ), this._texel.mul( 1.2 ), own ), b.a.mul( 3 ).min( 1 ) );
			const base = this.sharp ? this.sharp.rgb : color.sample( p ).rgb;
			return vec4( mix( base, b.rgb, w ), 1 );

		} );

		return composite();

	}

	dispose() {

		super.dispose();
		this._rt.dispose();
		for ( const rt of this._hist ) rt.dispose();
		this._material.dispose();
		this._accMaterial.dispose();

	}

}

export const lensBlur = ( node, depth, near, far, focus, range, maxPx, samples, sharp = null ) =>
	new LensBlurNode( convertToTexture( node ), depth, near, far, nodeObject( focus ), nodeObject( range ), nodeObject( maxPx ), samples, sharp ? nodeObject( sharp ) : null );
