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
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
        codemirror: {
          test: /[\\/]node_modules[\\/]@codemirror[\\/]/,
          name: 'codemirror',
          chunks: 'all',
          priority: 20,
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
