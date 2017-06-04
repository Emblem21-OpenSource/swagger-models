var jsyaml = require('js-yaml');
var fs = require('fs');
var models = {};

/**
 * [validModel description]
 * @param  {[type]} name [description]
 * @return {[type]}      [description]
 */
function isValidModelName(name) {
  return name[0].toUpperCase() === name[0] && this.hasOwnProperty(name);
}

/**
 * [defineProperty description]
 * @param  {[type]} propertySchema [description]
 * @return {[type]}                [description]
 */
function getPropertyType(models, currentModel, propertySchema) {
  if (typeof propertySchema === 'string') {
    propertySchema = {
      type: propertySchema,
    }
  }

  if (propertySchema.$ref) {
    return function postModel() {
      var targetModelName = propertySchema.items.$ref.replace('#/definitions/', '');
      var targetModel = models[targetModelName];
      currentModel.hasOne(targetModel);
      currentModel.belongsTo(targetModel, { as: targetModelName, foreignKey: 'id', constraints: false});
    }
  }

  if (propertySchema.enum) {
    return Sequelize.ENUM.apply(null, propertySchema.enum);
  }

  // as seen http://swagger.io/specification/#dataTypeType
  switch (propertySchema.type) {
    case 'string':
      switch (propertySchema.format || "") {
        case 'byte':
        case 'binary':
          if (propertySchema.maxLength > 5592415) {
            return Sequelize.BLOB('long');
          }

          if (propertySchema.maxLength > 21845) {
            return Sequelize.BLOB('medium');
          }

          // NOTE: VARCHAR(255) may container 255 multibyte chars: it's _NOT_ byte delimited
          if (propertySchema.maxLength > 255) {
            return Sequelize.BLOB();
          }
          return Sequelize.STRING.BINARY;

        case 'date':
          return Sequelize.DATEONLY;

        case 'date-time':
          return Sequelize.DATETIME;

        default:
          if (propertySchema.maxLength) {
            // http://stackoverflow.com/questions/13932750/tinytext-text-mediumtext-and-longtext-maximum-sto
            // http://stackoverflow.com/questions/7755629/varchar255-vs-tinytext-tinyblob-and-varchar65535-v
            // NOTE: text may be in multibyte format!
            if (propertySchema.maxLength > 5592415) {
              return Sequelize.TEXT('long');
            }

            if (propertySchema.maxLength > 21845) {
              return Sequelize.TEXT('medium')
            }

            // NOTE: VARCHAR(255) may container 255 multibyte chars: it's _NOT_ byte delimited
            if (propertySchema.maxLength > 255) {
              return Sequelize.TEXT();
            }
          }

          return Sequelize.STRING; // === VARCHAR
      }

    case 'array':
      if (dialect === 'postgres') {
        return Sequelize.ARRAY(getSequalizeType(propertySchema.items));
      } else {
        if(propertySchema.items.$ref) {
          return function postModel () {
            var targetModelName = propertySchema.items.$ref.replace('#/definitions/', '');
            var targetModel = models[targetModelName];
            currentModel.hasMany(targetModel);
            currentModel.belongsTo(targetModel, { as: targetModelName, foreignKey: 'id', constraints: false});
          }
        } else {
          console.log('Warning: encountered', JSON.stringify(propertySchema));
          console.log('Can only handle primitive array for postgres (yet?), see http://docs.sequelizejs.com/en/latest/api/datatypes/#array, falling back to blob');
          return Sequelize.BLOB;
        }        
      }

    case 'boolean':
      return Sequelize.BOOLEAN;

    case 'integer':
      switch (propertySchema.format || "") {
        case 'int32':
          if (typeof propertySchema.minimum === "number" && propertySchema.minimum >= 0) {
            return Sequelize.INTEGER.UNSIGNED;
          }
          return Sequelize.INTEGER;

        default:
          if (typeof propertySchema.minimum === "number" && propertySchema.minimum >= 0) {
            return Sequelize.BIGINT.UNSIGNED;
          }
          return Sequelize.BIGINT;
      }

    case 'number':
      switch (propertySchema.format || "") {
        case 'float':
          return Sequelize.FLOAT;

        default:
          return Sequelize.DOUBLE;
      }

    default:
      console.log('Warning: encountered', JSON.stringify(propertySchema));
      console.log('Unknown data type, falling back to blob');
      return Sequelize.BLOB;
  }
}

/**
 * [generate description]
 * @param  {[type]} schema [description]
 * @return {[type]}        [description]
 */
function generateProperties (schema) {
  var result = {
    schema: schema
    bindings: [],
    hiddenFields: []
  };

  Object.keys(schema.properties).forEach((propertyName) => {
    var propertySchema = schema.properties[propertyName];
    var type = getSequalizeType(propertySchema);
    
    if (properties.type instanceof Function) {
      result.bindings.push(type);
    } else {
      propertySchema.type = type;
    }

    if (propertySchema.default) {
      propertySchema.defaultValue = propertySchema.default;
    }

    if(propertySchema.description.indexOf('(hidden)') > -1) {
        result.hiddenFields.push(propertyName);
   }
  });

  return result;
}

/**
 * [exports description]
 * @param  {[type]} yamlContents [description]
 * @return {[type]}              [description]
 */
module.exports = {
  initialize: function initialize(yamlPath, sequelize, options) {
    var bindings = [];

    if(options === undefined) {
      options = {
        autosync: true
      };
    }

    if (Object.keys(this).length === 1) {
      var yamlContents = fs.readFileSync(yamlPath, 'utf8');
      var swaggerConfig = jsyaml.safeLoad(yamlContents);  

      // Prepare models
      for (var i in swaggerConfig.definitions) {
        if (isValidModelName.call(swaggerConfig, i)) {
          var properties = generateProperties(swaggerConfig.definitions[i]);
          this[i] = sequelize.define(i, properties.schema)
          bindings = bindings.concat(properties.bindings)
        }
      }

      // Generate models
      for (var i in swaggerConfig.definitions) {
        if (isValidModelName.call(swaggerConfig, i)) {

        }
      }

      // Sync them
      if (options.autosync) {
        for (i in this) {
          if(isValidModelName.call(this, i)) {
            console.log(i);
            this[i].sync({force: true});
          }
        }
      }

      delete this.initialize;
    }
  }  

}

module.exports = models;
