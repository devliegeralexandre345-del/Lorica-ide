const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: isProd ? '[name].[contenthash:8].js' : '[name].bundle.js',
    chunkFilename: isProd ? '[name].[contenthash:8].js' : '[name].chunk.js',
    clean: true,
  },
  target: 'web',
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { modules: false, targets: '> 0.5%, not dead' }],
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
    ],
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      // With the previous `vendor` group set to `chunks: 'all'`, webpack
      // was pulling every node_modules file — including mammoth (~1 MB)
      // and the long tail of lazy-only markdown deps — into the single
      // vendors bundle, defeating the dynamic imports. Restricting the
      // catch-all vendor group to `initial` chunks sends async-only deps
      // into the async chunk that triggered them, shrinking the initial
      // paint.
      cacheGroups: {
        // CodeMirror itself plus every direct runtime dep it pulls in.
        // Pre-pass-4 these helpers (`@lezer/common`, `@lezer/highlight`,
        // `style-mod`, `crelt`, `w3c-keyname`, `@marijn/find-cluster-break`)
        // landed in `vendors.bundle.js` because the cacheGroup test only
        // matched `@codemirror/*`. They're never used outside the editor
        // graph, so co-locating them with `codemirror.bundle.js` keeps the
        // entrypoint vendors slim without changing what's loaded for first
        // paint (codemirror is already an initial chunk).
        //
        // `chunks: 'initial'` matters here: it stops async-only @lezer
        // deps (like `@lezer/markdown`, only reached through dynamic
        // `import()` for the markdown viewer) from being pulled into the
        // eager codemirror bundle. They keep their own async chunks.
        codemirror: {
          test: /[\\/]node_modules[\\/](@codemirror|@lezer|style-mod|crelt|w3c-keyname|@marijn[\\/]find-cluster-break)[\\/]/,
          name: 'codemirror',
          chunks: 'initial',
          priority: 30,
        },
        xterm: {
          test: /[\\/]node_modules[\\/]@xterm[\\/]/,
          name: 'xterm',
          chunks: 'all',
          priority: 25,
        },
        // Heavy lib, only used by DocxPreview's `await import('mammoth/…')`.
        // Explicit `async` keeps it out of the initial bundle for good.
        mammoth: {
          test: /[\\/]node_modules[\\/]mammoth[\\/]/,
          name: 'mammoth',
          chunks: 'async',
          priority: 25,
        },
        // Spotify is gated behind `useSpotify`'s dynamic imports — split
        // the API client into its own async chunk so login-time fetches
        // arrive in one round-trip rather than several. We keep this
        // separate from the lazy `spotify` panel chunk (the React component
        // itself, see `SpotifyPlayer` lazy import in App.jsx).
        spotifyApi: {
          test: /[\\/]node_modules[\\/]spotify-web-api-js[\\/]/,
          name: 'spotify-api',
          chunks: 'async',
          priority: 25,
        },
        // Everything else from node_modules that is reachable from the
        // initial entry graph.
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'initial',
          priority: 10,
        },
      },
    },
    ...(isProd ? {
      minimize: true,
      usedExports: true,
      sideEffects: true,
    } : {}),
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      ...(isProd ? { minify: { collapseWhitespace: true, removeComments: true } } : {}),
    }),
    new MiniCssExtractPlugin({
      filename: isProd ? 'styles.[contenthash:8].css' : 'styles.css',
    }),
  ],
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    static: { directory: path.join(__dirname, 'dist') },
    headers: { 'Access-Control-Allow-Origin': '*' },
    client: {
      overlay: {
        errors: true,
        warnings: false,
        // Filter out benign Tauri IPC/HTTP aborts — the inline-AI
        // completion cancels inflight requests on every keystroke, and
        // @tauri-apps/plugin-http emits a post-abort "resource id N is
        // invalid" that surfaces as an unhandled rejection. It's just
        // bookkeeping noise, not a real runtime error.
        runtimeErrors: (error) => {
          const msg = error?.message || String(error || '');
          if (/resource id \d+ is invalid/i.test(msg)) return false;
          if (error?.name === 'AbortError') return false;
          if (/The operation was aborted/i.test(msg)) return false;
          return true;
        },
      },
    },
  },
  performance: {
    hints: isProd ? 'warning' : false,
    maxAssetSize: 500000,
    maxEntrypointSize: 500000,
  },
};
