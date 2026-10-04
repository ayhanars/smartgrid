/**
 * A bundled map patch: the middle of Berlin (Museum Island, the Spree,
 * Alexanderplatz), drawn by hand from the city's layout in the same
 * form the Overpass API returns (tagged ways with a lon/lat geometry),
 * so the product can be built and tried without the network and the
 * live data takes the same path. The streets and the landmarks are
 * where they are in the city, to a few tens of metres; the smaller
 * blocks are typical rather than surveyed.
 */
export interface SampleElement {
  tags: Record<string, string>
  /** [lon, lat] pairs; a closed ring repeats its first point. */
  points: [number, number][]
}

const CENTER = { lat: 52.5195, lon: 13.403 }
const K_LAT = 110_574
const K_LON = 111_320 * Math.cos((CENTER.lat * Math.PI) / 180)

const elements: SampleElement[] = []

const line = (tags: Record<string, string>, points: [number, number][]) => elements.push({ tags, points })

/** A rectangle `w` × `h` metres about (lon, lat), turned `deg` from east. */
function rect(tags: Record<string, string>, lon: number, lat: number, w: number, h: number, deg = 0) {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a)
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
  const pts = corners.map(([x, y]): [number, number] => [lon + (x * c - y * s) / K_LON, lat + (x * s + y * c) / K_LAT])
  pts.push(pts[0])
  elements.push({ tags, points: pts })
}

function circle(tags: Record<string, string>, lon: number, lat: number, r: number, n = 20) {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([lon + (r * Math.cos(a)) / K_LON, lat + (r * Math.sin(a)) / K_LAT])
  }
  pts.push(pts[0])
  elements.push({ tags, points: pts })
}

const building = (name: string, levels: number, lon: number, lat: number, w: number, h: number, deg = 0) => rect({ building: 'yes', name, 'building:levels': String(levels) }, lon, lat, w, h, deg)
const road = (highway: string, name: string, points: [number, number][]) => line({ highway, name }, points)

// ---- Water ----------------------------------------------------------
line({ waterway: 'river', name: 'Spree', width: '45' }, [
  [13.4215, 52.5118],
  [13.4178, 52.5143],
  [13.4125, 52.5148],
  [13.4075, 52.5148],
  [13.4055, 52.516],
  [13.4042, 52.5175],
  [13.4035, 52.5188],
  [13.4025, 52.5203],
  [13.401, 52.5213],
  [13.399, 52.5225],
  [13.3965, 52.5235],
  [13.3935, 52.5232],
  [13.39, 52.5222],
  [13.387, 52.5212],
  [13.382, 52.521],
])
line({ waterway: 'canal', name: 'Spreekanal', width: '22' }, [
  [13.4075, 52.5148],
  [13.4045, 52.5135],
  [13.4015, 52.5138],
  [13.4, 52.515],
  [13.3978, 52.5168],
  [13.3968, 52.5185],
  [13.3962, 52.5205],
  [13.3958, 52.5222],
  [13.3965, 52.5235],
])

// ---- Green ----------------------------------------------------------
rect({ leisure: 'park', name: 'Lustgarten' }, 13.3993, 52.5193, 110, 150, 12)
rect({ leisure: 'park', name: 'Marx-Engels-Forum' }, 13.4052, 52.5192, 150, 190, 25)
rect({ leisure: 'park', name: 'Monbijoupark' }, 13.3985, 52.5235, 210, 120, 5)
rect({ leisure: 'park', name: 'Park am Fernsehturm' }, 13.4068, 52.5203, 200, 140, 25)
rect({ leisure: 'park', name: 'Köllnischer Park' }, 13.414, 52.5135, 120, 110, 15)
rect({ leisure: 'park', name: 'Schloßplatz' }, 13.4015, 52.5162, 90, 70, 12)
rect({ landuse: 'grass', name: 'Humboldthain' }, 13.3892, 52.5235, 70, 70)

// ---- Roads ----------------------------------------------------------
road('primary', 'Unter den Linden', [
  [13.3775, 52.5163],
  [13.39, 52.5172],
  [13.3985, 52.518],
])
road('primary', 'Karl-Liebknecht-Straße', [
  [13.3985, 52.518],
  [13.404, 52.52],
  [13.41, 52.5225],
  [13.413, 52.5235],
  [13.418, 52.5248],
])
road('secondary', 'Spandauer Straße', [
  [13.4045, 52.516],
  [13.406, 52.52],
  [13.4065, 52.524],
])
road('secondary', 'Rathausstraße', [
  [13.403, 52.5178],
  [13.407, 52.5178],
  [13.412, 52.5185],
  [13.415, 52.5195],
])
road('primary', 'Grunerstraße', [
  [13.406, 52.515],
  [13.413, 52.5175],
  [13.417, 52.52],
])
road('primary', 'Mühlendamm', [
  [13.4, 52.5133],
  [13.406, 52.5145],
  [13.411, 52.5155],
  [13.42, 52.517],
])
road('primary', 'Gertraudenstraße', [
  [13.392, 52.512],
  [13.4, 52.5133],
])
road('residential', 'Breite Straße', [
  [13.403, 52.5162],
  [13.4045, 52.5135],
])
road('primary', 'Friedrichstraße', [
  [13.3875, 52.5095],
  [13.3878, 52.517],
  [13.387, 52.52],
  [13.3865, 52.527],
])
road('secondary', 'Oranienburger Straße', [
  [13.388, 52.5248],
  [13.395, 52.5245],
  [13.403, 52.5242],
  [13.4045, 52.5235],
])
road('secondary', 'Rosenthaler Straße', [
  [13.404, 52.5235],
  [13.403, 52.5275],
])
road('residential', 'Bodestraße', [
  [13.3975, 52.5212],
  [13.4015, 52.5205],
])
road('residential', 'Am Kupfergraben', [
  [13.395, 52.5185],
  [13.3955, 52.5215],
])
road('residential', 'Georgenstraße', [
  [13.388, 52.5205],
  [13.396, 52.522],
])
road('residential', 'Burgstraße', [
  [13.3995, 52.523],
  [13.404, 52.5215],
])
road('residential', 'An der Spandauer Brücke', [
  [13.403, 52.5225],
  [13.406, 52.5225],
])
road('residential', 'Dircksenstraße', [
  [13.405, 52.5235],
  [13.412, 52.5215],
  [13.415, 52.5205],
])
road('primary', 'Alexanderstraße', [
  [13.415, 52.5195],
  [13.418, 52.515],
])
road('primary', 'Karl-Marx-Allee', [
  [13.415, 52.52],
  [13.425, 52.5195],
])
road('residential', 'Poststraße', [
  [13.4055, 52.516],
  [13.4075, 52.5165],
])
road('residential', 'Propststraße', [
  [13.4065, 52.5155],
  [13.408, 52.5172],
])
road('residential', 'Werderscher Markt', [
  [13.398, 52.5155],
  [13.4, 52.5165],
])
road('residential', 'Französische Straße', [
  [13.388, 52.5148],
  [13.396, 52.5152],
])
road('residential', 'Behrenstraße', [
  [13.388, 52.5158],
  [13.396, 52.516],
])
road('primary', 'Leipziger Straße', [
  [13.387, 52.5105],
  [13.392, 52.5112],
])
road('residential', 'Dorotheenstraße', [
  [13.388, 52.5185],
  [13.396, 52.519],
])
road('residential', 'Oberwallstraße', [
  [13.3965, 52.512],
  [13.397, 52.5155],
])
road('residential', 'Jüdenstraße', [
  [13.4095, 52.5165],
  [13.411, 52.519],
])
road('residential', 'Klosterstraße', [
  [13.412, 52.516],
  [13.4135, 52.5185],
])
road('residential', 'Neue Schönhauser Straße', [
  [13.4045, 52.5245],
  [13.408, 52.526],
])
road('residential', 'Münzstraße', [
  [13.406, 52.5245],
  [13.411, 52.5235],
])
road('residential', 'Sophienstraße', [
  [13.3995, 52.5255],
  [13.404, 52.5252],
])
road('residential', 'Tucholskystraße', [
  [13.3935, 52.5225],
  [13.392, 52.527],
])
road('residential', 'Fischerinsel', [
  [13.4065, 52.5125],
  [13.411, 52.5135],
])
road('residential', 'Wallstraße', [
  [13.405, 52.5115],
  [13.414, 52.5125],
])
road('residential', 'Stralauer Straße', [
  [13.411, 52.5155],
  [13.418, 52.5165],
])
road('residential', 'Memhardstraße', [
  [13.409, 52.5235],
  [13.413, 52.5245],
])
road('path', 'Lustgarten walk', [
  [13.3985, 52.5185],
  [13.3998, 52.5203],
])

// ---- Rail (the Stadtbahn viaduct) ------------------------------------
line({ railway: 'rail', name: 'Stadtbahn' }, [
  [13.38, 52.5205],
  [13.387, 52.5203],
  [13.396, 52.5218],
  [13.4025, 52.5228],
  [13.406, 52.5228],
  [13.411, 52.5215],
  [13.416, 52.5185],
  [13.4185, 52.515],
  [13.42, 52.512],
])

// ---- Landmarks ----------------------------------------------------------
building('Berliner Dom', 10, 13.401, 52.519, 75, 95, 12)
building('Altes Museum', 5, 13.3985, 52.52, 90, 55, 12)
building('Neues Museum', 5, 13.3975, 52.5205, 100, 45, 12)
building('Alte Nationalgalerie', 6, 13.3983, 52.5209, 60, 40, 12)
building('Pergamonmuseum', 6, 13.3965, 52.5213, 110, 80, 12)
building('Bode-Museum', 6, 13.3948, 52.5222, 70, 60, 20)
building('Humboldt Forum', 8, 13.401, 52.5174, 180, 110, 12)
building('Humboldt-Universität', 5, 13.3934, 52.5179, 110, 90)
building('Staatsoper', 6, 13.3948, 52.5168, 90, 45)
building('Zeughaus', 5, 13.3968, 52.5183, 85, 75, 12)
building('Neue Wache', 3, 13.396, 52.5178, 35, 30)
building('Marienkirche', 8, 13.4071, 52.5203, 60, 25, 25)
circle({ building: 'tower', name: 'Fernsehturm', 'building:levels': '40' }, 13.4094, 52.5208, 14)
building('Fernsehturm foot', 3, 13.4094, 52.5206, 60, 40, 25)
building('Rotes Rathaus', 8, 13.4082, 52.5182, 95, 85, 25)
building('Nikolaikirche', 8, 13.4072, 52.5165, 40, 25, 25)
building('Alexanderplatz Bahnhof', 3, 13.411, 52.5215, 180, 40, -30)
building('Alexa', 7, 13.4155, 52.5192, 120, 100, 25)
building('Hotel Park Inn', 37, 13.4125, 52.5225, 50, 50)
building('Galeria', 7, 13.4138, 52.5212, 90, 60, 25)
building('Haus des Lehrers', 12, 13.416, 52.5205, 40, 35)
building('Dom Aquarée', 6, 13.4035, 52.5197, 90, 70, 25)
building('Hackescher Markt Bahnhof', 3, 13.4024, 52.5226, 110, 25, 10)
building('Hackesche Höfe', 5, 13.402, 52.5245, 110, 70)
building('Friedrichstraße Bahnhof', 4, 13.387, 52.5203, 120, 40, 10)
building('Bundestag Jakob-Kaiser-Haus', 6, 13.383, 52.5195, 60, 80)
building('Alte Bibliothek', 5, 13.3925, 52.5168, 60, 30)
building('Kronprinzenpalais', 4, 13.3975, 52.5173, 60, 25, 12)
building('Bauakademie', 5, 13.399, 52.5155, 40, 40, 12)
building('Auswärtiges Amt', 6, 13.3998, 52.5143, 100, 70, 12)
building('Nikolaiviertel', 4, 13.4065, 52.5162, 70, 50, 25)
building('Nikolaiviertel 2', 4, 13.4082, 52.5169, 40, 35, 25)
building('Ephraim-Palais', 4, 13.4058, 52.5152, 30, 30, 25)
building('Altes Stadthaus', 6, 13.4125, 52.5165, 90, 70, 20)
building('Mühlendamm block', 7, 13.4085, 52.5135, 80, 40, 10)
building('Fischerinsel', 21, 13.4075, 52.5128, 22, 22)
building('Fischerinsel 2', 21, 13.4095, 52.5125, 22, 22)
building('Fischerinsel 3', 21, 13.411, 52.5133, 22, 22)
building('Fischerinsel 4', 21, 13.4087, 52.5118, 22, 22)
building('Gendarmenmarkt block', 6, 13.3935, 52.5145, 80, 60)
building('Französischer Dom', 8, 13.392, 52.5142, 30, 30)
building('Stadtmitte block', 6, 13.3905, 52.513, 90, 50)
building('Leipziger block', 6, 13.3925, 52.5118, 80, 40)
building('Dorotheenstadt block', 6, 13.391, 52.5188, 90, 50)
building('Dorotheenstadt block 2', 6, 13.3935, 52.5205, 60, 30, 10)
building('Monbijou block', 5, 13.3955, 52.5245, 90, 60)
building('Oranienburger block', 5, 13.3975, 52.5255, 70, 50)
building('Sophienkirche', 6, 13.4005, 52.5262, 30, 20)
building('Spandauer Vorstadt block', 5, 13.4055, 52.5255, 80, 55, 25)
building('Spandauer Vorstadt block 2', 5, 13.409, 52.5245, 70, 45, 25)
building('Münzstraße block', 5, 13.4075, 52.5238, 60, 35, 25)
building('Rosenthaler block', 5, 13.4035, 52.5265, 70, 45)
building('Karl-Liebknecht block', 7, 13.4072, 52.5225, 110, 35, 25)
building('Haus des Reisens', 17, 13.4155, 52.5218, 40, 25)
building('Alexanderhaus', 7, 13.4128, 52.5208, 55, 30, -30)
building('Berolinahaus', 7, 13.4115, 52.5218, 55, 30, -30)
building('Grunerstraße block', 6, 13.4115, 52.5178, 70, 40, 25)
building('Stralauer block', 6, 13.4145, 52.5165, 70, 40, 15)
building('Jannowitz block', 7, 13.4175, 52.5178, 60, 50)
building('Wallstraße block', 6, 13.411, 52.5118, 90, 40, 10)
building('Wallstraße block 2', 6, 13.4075, 52.511, 70, 40, 10)
building('Petriplatz block', 6, 13.405, 52.5125, 50, 40, 20)
building('Breite Straße block', 6, 13.4035, 52.5145, 40, 70, 12)
building('Werder block', 5, 13.3975, 52.5138, 60, 40, 12)
building('Georgenstraße block', 5, 13.3905, 52.5212, 70, 25, 10)
building('Spree block', 6, 13.3985, 52.5235, 50, 30)
building('Tucholsky block', 5, 13.3935, 52.5255, 60, 45)
building('Klosterstraße block', 6, 13.4135, 52.5193, 60, 40, 25)
building('Alexanderstraße block', 8, 13.4175, 52.5175, 50, 50)
building('Karl-Marx-Allee block', 8, 13.4195, 52.5203, 110, 40)

export const BERLIN_MITTE = { center: CENTER, elements }
