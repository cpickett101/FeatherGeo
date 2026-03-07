import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';
import { DragEvent } from 'react';
import { GeoJSON } from 'ol/format';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import { Feature } from 'ol';
import { Geometry } from 'ol/geom';
import { GDALService } from '../lib/gdalService';
import { GeoJSON as GeoJSONType } from 'geojson';

interface MapWithDropzoneProps {
  onFilesProcessed?: (features: any[]) => void;
}

const MapWithDropzone: React.FC<MapWithDropzoneProps> = ({ onFilesProcessed }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [vectorLayer, setVectorLayer] = useState<VectorLayer<VectorSource> | null>(null);
  const [map, setMap] = useState<Map | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('');

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) return;

    const map = new Map({
      target: 'map',
      layers: [
        new TileLayer({
          source: new OSM()
        })
      ],
      view: new View({
        center: fromLonLat([0, 0]),
        zoom: 2
      })
    });

    setMap(map);
    mapInstance.current = map;

    return () => {
      if (map) {
        map.setTarget(undefined);
      }
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const shapefileExtensions = ['.shp', '.dbf', '.shx', '.prj', '.cpg', '.qpj', '.shp.xml'];
    
    const shapefileFiles = files.filter(file => {
      const ext = file.name.toLowerCase();
      return shapefileExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    });

    if (shapefileFiles.length === 0) {
      setStatus('No valid shapefile components found. Please drop shapefile files (.shp, .dbf, .shx, etc.)');
      return;
    }

    setIsProcessing(true);
    setStatus('Processing shapefile...');

    try {
      const gdal = await GDALService.getInstance();
      const result = await gdal.processShapefile(shapefileFiles);
      
      // Process and display on map
      if (result && result.features && result.features.length > 0) {
        displayGeoJSON(result);
        onFilesProcessed?.(result.features);
        setStatus(`Loaded ${result.features.length} features`);
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [onFilesProcessed]);

  const displayGeoJSON = (geojson: GeoJSONType) => {
    if (!map) return;

    // Remove existing vector layer
    if (vectorLayer) {
      map.removeLayer(vectorLayer);
    }

    const vectorSource = new VectorSource({
      features: new GeoJSON().readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      })
    });

    const newVectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        fill: new Fill({
          color: 'rgba(255, 0, 0, 0.2)'
        }),
        stroke: new Stroke({
          color: '#ff0000',
          width: 2
        })
      })
    });

    map.addLayer(newVectorLayer);
    setVectorLayer(newVectorLayer);

    // Zoom to extent
    const extent = vectorSource.getExtent();
    map.getView().fit(extent, { padding: [50, 50, 50, 50] });
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={mapRef}
        style={{ width: '100%', height: '100%' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={isDragging ? 'drag-over' : ''}
      >
        {isDragging && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              padding: '20px',
              background: 'white',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              Drop shapefiles here
            </div>
          </div>
        )}
      </div>
      {status && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'white',
          padding: '5px 10px',
          borderRadius: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        }}>
          {status}
        </div>
      )}
      {isProcessing && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'white',
          padding: '10px 20px',
          borderRadius: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        }}>
          Processing shapefile...
        </div>
      )}
    </div>
  );
};

export default MapWithDropzone;