import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import { fromLonLat } from 'ol/proj'
import 'ol/ol.css'

new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM(), // OpenStreetMap — OSGeo project
    }),
  ],
  view: new View({
    center: fromLonLat([0, 20]),
    zoom: 2,
  }),
})
