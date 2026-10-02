import test from 'node:test';
import assert from 'node:assert/strict';
import { queryTracks } from './track-query.ts';
const tracks = [
 {id:1,title:'Song 10',artist:'Artist',album:'Album',year:'2020',duration:180,source:'a.flac',customTags:['夜晚','轻音乐'],available:true},
 {id:2,title:'Song 2',artist:'Artist',album:'Other',year:'',duration:60,source:'a.mp3',customTags:['夜晚'],available:false},
 {id:3,title:'Song 1',artist:'Other',album:'Album',year:'2024',duration:120,source:'https://a/a.flac?x=1',kind:'network',customTags:['轻音乐'],available:true},
];
test('conditions intersect tags, favorites, source and numeric ranges',()=>{
 assert.deepEqual(queryTracks(tracks,{tags:['夜晚','轻音乐'],favorite:'liked',source:'local',minYear:2019,maxDuration:200},[1,3]).map(t=>t.id),[1]);
 assert.deepEqual(queryTracks(tracks,{tags:['夜晚','轻音乐'],tagMode:'any',availability:'missing'},[]).map(t=>t.id),[2]);
 assert.deepEqual(queryTracks(tracks,{minYear:2020},[]).map(t=>t.id),[1,3]);
 assert.deepEqual(queryTracks(tracks,{format:'flac',source:'network'},[]).map(t=>t.id),[3]);
});
test('sorting is numeric, reversible and never changes input order',()=>{
 assert.deepEqual(queryTracks(tracks,{},[],'title').map(t=>t.id),[3,2,1]);
 assert.deepEqual(queryTracks(tracks,{},[],'duration',true).map(t=>t.id),[1,3,2]);
 assert.deepEqual(tracks.map(t=>t.id),[1,2,3]);
});
