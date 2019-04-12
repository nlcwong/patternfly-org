/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */
const path = require('path');
const glob = require('glob');
const navHelpers = require("./src/helpers/navHelpers");
// const styleFinder = require('./scripts/find-react-styles');

// Map to handlebars partial files for Core
let partialsToLocationsMap = null;

exports.onCreateNode = ({ node, actions }) => {
  const { createNodeField } = actions;
  const reactComponentPathRegEx = /\/documentation\/react\/.*/;
  const coreComponentPathRegEx = /\/documentation\/core\/.*/;
  const isSitePage = node.internal.type === 'SitePage';
  if (isSitePage) {
    if (reactComponentPathRegEx.test(node.path)) {
      const reactPathLabel = node.component
        .split('/')
        .pop()
        .split('.')
        .shift()
        .replace(/([A-Z])/g, ' $1');

      createNodeField({
        node,
        name: 'label',
        value: reactPathLabel
      });
    } else if (coreComponentPathRegEx.test(node.path)) {
      const corePathLabel = node.component
        .split('/')
        .slice(-3)[0]
        .replace(/([A-Z])/g, ' $1');

      createNodeField({
        node,
        name: 'label',
        value: corePathLabel
      });
      createNodeField({
        node,
        name: 'type',
        value: node.path.split('/')[3]
      });
    }
  }
};

exports.createPages = ({ graphql, actions }) => {
  const redirects = [
    { f: `/get-started`, t: `/get-started/about` },
    { f: `/design-guidelines`, t: `/design-guidelines/styles/icons` },
    { f: `/documentation`, t: `/documentation/react/components/aboutmodal` }
  ];
  redirects.forEach(({ f, t }) => {
    actions.createRedirect({
      fromPath: f,
      redirectInBrowser: true,
      toPath: t
    })
    console.log('\nRedirecting: ' + f + ' to: ' + t);
  })
  return new Promise((resolve, reject) => {
    graphql(`
      query AllDocsFiles {
        pf4Docs: allMdx(filter: {fileAbsolutePath: {glob: "**/patternfly-4/_repos/react*/**"} }) {
          edges {
            node {
              fileAbsolutePath
              frontmatter {
                section
                title
                fullscreen
              }
            }
          }
        },
        coreDocs: allFile(filter: { sourceInstanceName: { eq: "core" }, absolutePath: { glob: "**/examples/index.js" } }) {
          edges {
            node {
              relativePath
              relativeDirectory
              absolutePath
              base
              name
            }
          }
        }
        contentPages: allMdx(filter: {fileAbsolutePath: {glob: "**/patternfly-4/content/**"}, frontmatter: {path: {ne: null}}}) {
          edges {
            node {
              fileAbsolutePath
              frontmatter {
                path
              }
            }
          }
        }
      }
    `).then(result => {
      if (result.errors) {
        return reject(result.errors);
      }
      const { pf4Docs, coreDocs, contentPages} = result.data;

      contentPages.edges.forEach(({ node }) => {
        console.log(`creating content page (mdx): ${node.frontmatter.path}`);
        actions.createPage({
          path: node.frontmatter.path,
          component: path.resolve(`src/templates/contentTemplate.js`),
          context: {}, // additional data can be passed via context
        })
      });

      pf4Docs.edges.forEach(({node}) => {
        const componentName = navHelpers.getFileName(node.fileAbsolutePath);
        const parentFolderName = navHelpers.getParentFolder(node.fileAbsolutePath, 3);
        const folderName = navHelpers.getParentFolder(node.fileAbsolutePath);
        const section = node.frontmatter.section ? node.frontmatter.section : 'components';
  
        let link = '/bad-page/';
        // Create fullscreen example component pages
        if (node.frontmatter.fullscreen) {
          link = `/documentation/react/${section}/${parentFolderName}/${componentName}/`.toLowerCase();
          console.log('creating pf4 fullscreen page (mdx):', link);
          actions.createPage({
            path: link,
            component: path.resolve('./src/templates/mdxFullscreenTemplate.js'),
            context: {
              title: node.frontmatter.title,
              fileAbsolutePath: node.fileAbsolutePath, // Helps us get the markdown
            }
          });
        } else {
          // Normal templated component pages
          link = `/documentation/react/${section}/${componentName}/`.toLowerCase();
          console.log('creating pf4 doc page (mdx):', link);
          actions.createPage({
            path: link,
            component: path.resolve('./src/templates/mdxPF4Template.js'),
            context: {
              title: node.frontmatter.title,
              fileAbsolutePath: node.fileAbsolutePath, // Helps us get the markdown
              pathRegex: `/${folderName}\/.*/` // Helps us get the docgenned props
            }
          });
        }
      });

      coreDocs && coreDocs.edges.forEach(({ node }) => {
        const shortenedPath = node.relativePath.split('/').slice(2, 4).join('/').toLowerCase();
        const examplePath = `/documentation/core/${shortenedPath}`;

        console.log(`creating core doc page (${node.absolutePath}):`, examplePath);
        actions.createPage({
          path: examplePath,
          component: path.resolve(__dirname, node.absolutePath)
        });
      });
    });
    resolve();
  });
};

exports.onCreateWebpackConfig = ({ stage, loaders, actions, plugins, getConfig }) =>
  new Promise((resolve, reject) => {
    if (partialsToLocationsMap === null) {
      partialsToLocationsMap = {};
      glob(path.resolve(__dirname, './_repos/core/src/patternfly/**/*.hbs'), { ignore: '**/examples/**' }, (err, files) => {
        files.forEach(file => {
          const fileNameArr = file.split('/');
          const fileName = fileNameArr[fileNameArr.length - 1].slice(0, -4);
          partialsToLocationsMap[fileName] = file;
        });
        continueWebpackConfig({ stage, loaders, actions, plugins, getConfig });
        resolve();
      });
    } else {
      continueWebpackConfig({ stage, loaders, actions, plugins, getConfig });
      resolve();
    }
});

const continueWebpackConfig = ({ stage, loaders, actions, plugins, getConfig }) => {
  const pfStylesTest = /patternfly.*(components|layouts|utilities).*\.css$/;
  actions.setWebpackConfig({
    module: {
      rules: [
        {
          test: /\.md$/,
          loader: 'html-loader!markdown-loader'
        },
        {
          test: /\.hbs$/,
          query: {
            extensions: '.hbs',
            partialResolver(partial, callback) {
              if (partialsToLocationsMap[partial]) {
                callback(null, partialsToLocationsMap[partial]);
              } else {
                callback(new Error(`Could not find partial: ${partial}`), '');
              }
            },
            helperDirs: path.resolve(__dirname, './_repos/core/build/helpers')
          },
          loader: 'handlebars-loader'
        }
      ]
    },
    resolve: {
      alias: {
        '@siteComponents': path.resolve(__dirname, './src/components/_core'),
        '@components': path.resolve(__dirname, './_repos/core/src/patternfly/components'),
        '@layouts': path.resolve(__dirname, './_repos/core/src/patternfly/layouts'),
        '@demos': path.resolve(__dirname, './_repos/core/src/patternfly/demos'),
        '@project': path.resolve(__dirname, './_repos/core/src'),
        '@content': path.resolve(__dirname, './src/components/content')
      }
    },
    resolveLoader: {
      alias: { raw: 'raw-loader' }
    }
  });

  if (stage === `build-javascript`) {
    let config = getConfig();
    config.optimization = {
      runtimeChunk: {
        name: `webpack-runtime`,
      },
      splitChunks: {
        name: false,
        cacheGroups: {
          styles: {
            name: `styles`,
            // This should cover all our types of CSS.
            test: /\.(css|scss|sass|less|styl)$/,
            chunks: `all`,
            enforce: true,
          },
        },
      },
      minimizer: [
        plugins.minifyJs({
          terserOptions: {
            keep_fnames: true
          }
        }),
        plugins.minifyCss(),
      ].filter(Boolean),
    }
    actions.replaceWebpackConfig(config);
  }
};
